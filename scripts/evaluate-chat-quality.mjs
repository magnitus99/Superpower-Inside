#!/usr/bin/env node

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import {
  createEvaluationProvider,
  syntheticVault,
  evaluateToolLoop,
  evaluateRetrieval,
  evaluateEvidenceCollection,
  isEvaluationHostAlive,
} from './chat-tool-evaluation.mjs';
import { createPublicToolCases } from './chat-tool-scenarios.mjs';
import { createEvidenceCollectionCases } from './evidence-collection-scenarios.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(
  await readFile(path.join(repository, 'tests/fixtures/chat-quality.json'), 'utf8'),
);
fixture.cases.push(...createPublicToolCases());
fixture.cases.push(...createEvidenceCollectionCases());

// 볼트 I/O만 합성 데이터로 치환하며 컨텍스트·도구·provider 구현은 그대로 번들합니다.
const obsidianAdapter = `
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { load } from 'js-yaml';
export const parseYaml = load;
export function getFrontMatterInfo(content) {
  const match = /^\\uFEFF?---\\r?\\n([\\s\\S]*?)\\r?\\n(?:---|\\.\\.\\.)(?:\\r?\\n|$)/.exec(content);
  return { exists: match !== null, frontmatter: match?.[1] ?? '' };
}
export const TFile = globalThis.app?.vault.getFiles()[0]?.constructor ?? class {};
export const TFolder = globalThis.app?.vault.getRoot()?.constructor ?? class {};
export class FileView {}
export function normalizePath(value) { return value.replaceAll('\\\\', '/'); }
export function getAllTags(cache) {
  const frontmatter = cache.frontmatter?.tags;
  return [...(cache.tags?.map(item => item.tag) ?? []),
    ...(Array.isArray(frontmatter) ? frontmatter : typeof frontmatter === 'string' ? [frontmatter] : [])];
}
export async function requestUrl(options) {
  return new Promise((resolve, reject) => {
    const request = (options.url.startsWith('https:') ? httpsRequest : httpRequest)(options.url,
      { method: options.method, headers: options.headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const bytes = Buffer.concat(chunks), text = bytes.toString('utf8');
        let json; try { json = JSON.parse(text); } catch { json = null; }
        resolve({ status: response.statusCode, headers: response.headers, text, json,
          arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
      });
    });
    request.setTimeout(120000, () => request.destroy(new Error('평가 요청 시간 초과')));
    request.on('error', reject); request.end(options.body);
  });
}
`;

async function compileRuntime(root, directory) {
  const hasBudget = await access(path.join(root, 'src/llm/request-budget.ts')).then(
    () => true,
    () => false,
  );
  const source = `
    export { TFile, TFolder } from 'obsidian';
    export { buildChatContext } from './src/chat/context';
    export { VaultResearchAgent } from './src/agent/research-agent';
    export { ObsidianNativeVaultToolPort } from './src/agent/obsidian-native-vault-port';
    export { NativeVaultToolRuntime, createNativeVaultToolDefinitions } from './src/agent/native-vault-tool';
    export { planAgenticToolTurn } from './src/chat/tool-orchestration';
    export { collectVaultEvidence, finalizeEvidenceAnswer } from './src/chat/evidence-collection';
    export { createProviderForStrategy } from './src/llm/providers';
    export { getEffectiveSystemPrompt } from './src/chat/prompt-library';
    export { setLanguage } from './src/i18n';
    export { appLogger } from './src/utils/logger';
    export { initializeChatGPTOAuth } from './src/llm/chatgpt-oauth';
    export { getRagCandidateFiles } from './src/utils/vault';
    export { createToolEvidencePrompt, createCompatibilityToolPrompt, parseCompatibilityToolTurn } from './src/chat/tool-protocol';
    export { prepareAssistantToolCalls, executeAssistantToolCalls, appendAssistantToolRound,
      markRepeatedToolCalls, collectToolCitations, enforceNativeToolAnswerContract } from './src/chat/tool-execution';
    export { appendAgenticCheckpoint, selectAgenticToolDefinitions } from './src/chat/tool-orchestration';
    ${
      hasBudget
        ? "export { prepareProviderRequest } from './src/llm/request-budget';"
        : "export const prepareProviderRequest = messages => ({messages:[...messages.filter(m=>m.role==='system'), ...messages.filter(m=>m.role!=='system').slice(-10)]});"
    }
  `;
  const outfile = path.join(directory, 'runtime.cjs');
  await build({
    stdin: { contents: source, resolveDir: root, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'silent',
    nodePaths: [path.join(repository, 'node_modules')],
    plugins: [
      {
        name: 'synthetic-obsidian',
        setup(builder) {
          builder.onResolve({ filter: /^obsidian$/ }, () => ({
            path: 'obsidian',
            namespace: 'synthetic',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, () => ({
            contents: obsidianAdapter,
            loader: 'js',
            resolveDir: repository,
          }));
        },
      },
    ],
  });
  const runtime = (await import(pathToFileURL(outfile).href)).default;
  runtime.setLanguage('ko');
  return runtime;
}

async function evaluate(runtime, settings) {
  if (
    settings?.providerProfiles.find((item) =>
      settings.chat.defaultModel.startsWith(`profile:${item.id}:`),
    )?.strategy === 'openAIChatGPT'
  ) {
    throw new Error(
      '선택 모델은 Obsidian OAuth 저장소가 필요합니다. --obsidian-vault로 실행하세요.',
    );
  }
  const provider = createEvaluationProvider(runtime, settings);
  const results = [];
  for (const test of fixture.cases) {
    const start = performance.now();
    const { files, app } = syntheticVault(runtime, test);
    if (test.workflow === 'evidence-collection') {
      results.push(await evaluateEvidenceCollection(runtime, test, { files, app }));
      continue;
    }
    if (test.workflow === 'tool-loop') {
      const vault = { files, app };
      const retrieval = await evaluateRetrieval(runtime, test, vault);
      for (const protocol of ['native', 'compatibility']) {
        const loop = await evaluateToolLoop(runtime, provider, test, vault, protocol);
        results.push({
          ...loop,
          contractPassed: loop.contractPassed && retrieval.every((probe) => probe.recallAtK === 1),
          retrieval,
        });
      }
      continue;
    }
    let evidence = '',
      citations = [],
      answer = null,
      providerCalls = 0,
      modelRequests = 0,
      toolCalls = 0,
      contractPassed;
    if (test.workflow === 'research') {
      const requests = [];
      const model = {
        chat: async (...arguments_) => {
          requests.push(arguments_[0]);
          modelRequests += 1;
          if (provider) providerCalls += 1;
          return provider
            ? provider.chat(...arguments_)
            : 'Alpha 담당자 Mina, Beta 보안 검토 미완료 [vault:Alpha.md:1-1] [vault:Beta.md:1-1]';
        },
      };
      const port = new runtime.ObsidianNativeVaultToolPort(
        app,
        {
          listCandidateFiles: async () => files,
          isCandidateFile: async (file) => files.includes(file),
          isExplicitReadAllowed: async (file) => files.includes(file),
          isPathVisible: () => true,
        },
        () => null,
      );
      const native = new runtime.NativeVaultToolRuntime(port);
      const result = await new runtime.VaultResearchAgent(model, {
        execute: (...args) => {
          toolCalls += 1;
          return native.execute(...args);
        },
      }).run({ question: test.question, systemPrompt: test.systemPrompt });
      const finalRequest =
        requests
          .at(-1)
          ?.map((message) => message.content)
          .join('\n') ?? '';
      contractPassed =
        finalRequest.includes(test.systemPrompt) &&
        !requests[0]?.some((message) => message.content.includes(test.systemPrompt));
      citations = result.citations;
      answer = provider ? result.content : null;
    } else if (test.workflow === 'policy') {
      const result = runtime.planAgenticToolTurn({
        question: test.question,
        contextAttachments: [],
        explicitToolServerCount: 0,
        toolDefinitions: runtime.createNativeVaultToolDefinitions(),
        phase: 'after-tools',
        round: 1,
        maxRounds: 10,
        toolCalls: [
          {
            id: 'read',
            name: 'superpower_inside_read',
            executionKind: 'native',
            status: 'success',
            arguments: '{"path":"Plan.md"}',
            normalizedResult: JSON.stringify({
              action: 'read',
              path: 'Plan.md',
              startLine: 1,
              endLine: 1,
              totalLines: 1,
              content: 'Original deployment: Friday.',
              truncated: false,
              citations: [{ id: 'vault:Plan.md:1-1', filePath: 'Plan.md', status: 'verified' }],
            }),
          },
        ],
      });
      contractPassed = result?.toolChoice === 'auto';
    } else {
      const context = await runtime.buildChatContext(test.question, {
        app,
        maxContextChars: test.maxContextChars,
        maxFolderFiles: test.maxFolderFiles,
      });
      citations = context.citations;
      const history = [...(test.history ?? [])];
      for (let index = 0; index < (test.fillerTurns ?? 0); index += 1)
        history.push(
          { role: 'user', content: `일반 확인 ${index}` },
          { role: 'assistant', content: '확인했습니다.' },
        );
      const prompt = settings
        ? runtime.getEffectiveSystemPrompt(settings)
        : '한국어로 현재 질문에 답하고 전달된 원문만 근거로 사용하세요. 근거가 없으면 확인하지 못했다고 밝히세요.';
      const request = runtime.prepareProviderRequest([
        { role: 'system', content: [prompt, context.systemPrompt].filter(Boolean).join('\n\n') },
        ...history,
        { role: 'user', content: test.question },
      ]);
      evidence = request.messages.map((message) => message.content).join('\n');
      contractPassed =
        test.expectedEvidence.every((value) => evidence.includes(value)) &&
        (!test.expectNoVerifiedSources ||
          citations.every((citation) => citation.status !== 'verified'));
      if (provider) {
        modelRequests += 1;
        providerCalls += 1;
        answer = await provider.chat(request.messages, 0.7);
      }
    }
    results.push({
      id: test.id,
      contractPassed,
      elapsedMs: Math.round(performance.now() - start),
      toolCalls,
      providerCalls,
      modelRequests,
      verifiedSources: citations.filter((citation) => citation.status === 'verified').length,
      semanticQualityAssessed: false,
      answer,
      referenceFactMatches:
        answer === null ? null : test.expectedFacts.filter((value) => answer.includes(value)),
      forbiddenClaimMatches:
        answer === null ? null : test.forbiddenClaims.filter((value) => answer.includes(value)),
      citedSourceIds:
        answer === null
          ? null
          : citations
              .filter((citation) => answer.includes(citation.id))
              .map((citation) => citation.id),
    });
  }
  return results;
}

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const directory = await mkdtemp(path.join(tmpdir(), 'chat-quality-'));
try {
  const settingsPath = option('--settings');
  const settings = settingsPath
    ? JSON.parse(await readFile(path.resolve(settingsPath), 'utf8'))
    : undefined;
  const currentDirectory = path.join(directory, 'current');
  await mkdir(currentDirectory);
  const runtime = await compileRuntime(repository, currentDirectory);
  const obsidianVault = option('--obsidian-vault');
  if (obsidianVault) {
    if (option('--compare-ref')) throw new Error('실제 볼트 비교는 각 ref에서 따로 실행하세요.');
    if (option('--fixtures')) throw new Error('실제 볼트 사례는 메모리에서만 생성합니다.');
    const count = Number(option('--cases') ?? 80);
    const concurrency = Number(option('--concurrency') ?? 2);
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 800 ||
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 4
    )
      throw new Error('평가 개수 또는 동시 실행 범위 오류');
    const helper = path.join(directory, 'tool-evaluation.cjs');
    await build({
      entryPoints: [path.join(repository, 'scripts/chat-tool-evaluation.mjs')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: helper,
      logLevel: 'silent',
    });
    const output = path.resolve(option('--output') ?? path.join(directory, 'summary.json'));
    const statusPath = path.join(directory, 'status.json');
    const code = `void (async()=>{let stage='runtime';try{const runtime=require(${JSON.stringify(path.join(currentDirectory, 'runtime.cjs'))});
      runtime.setLanguage('ko'); const helper=require(${JSON.stringify(helper)});
      const settings=app.plugins.plugins['superpower-inside']?.settings;
      if(!settings)throw new Error('plugin-unavailable');
      stage='evaluation';require('node:fs').writeFileSync(${JSON.stringify(statusPath)},JSON.stringify({running:true,hostPid:process.pid}));
      const report=await helper.evaluateObsidianVault(runtime,app,settings,{
        count:${count},concurrency:${concurrency},localOnly:${args.includes('--local-only')},signal:AbortSignal.timeout(87*60_000),
        onProgress:progress=>require('node:fs').writeFileSync(${JSON.stringify(statusPath)},JSON.stringify({running:true,hostPid:process.pid,...progress}))});
      require('node:fs').writeFileSync(${JSON.stringify(output)},JSON.stringify(report,null,2));
      require('node:fs').writeFileSync(${JSON.stringify(statusPath)},JSON.stringify({completed:true}));
    }catch(error){require('node:fs').writeFileSync(${JSON.stringify(statusPath)},JSON.stringify({completed:false,stage,status:Number.isInteger(error.status)?error.status:null}));}})();'평가 시작'`;
    const result = execFileSync(
      option('--obsidian-cli') ?? '/Applications/Obsidian.app/Contents/MacOS/obsidian-cli',
      [`vault=${obsidianVault}`, 'eval', `code=${code}`],
      { encoding: 'utf8', timeout: 30 * 60_000 },
    );
    if (result.includes('Error:')) throw new Error('Obsidian 평가 스크립트를 시작하지 못했습니다.');
    const deadline = Date.now() + 90 * 60_000;
    let status;
    let lastProgress = 0;
    while (true) {
      status = await readFile(statusPath, 'utf8').then(
        (value) => JSON.parse(value),
        () => null,
      );
      if (status && !status.running) break;
      if (status?.running && !isEvaluationHostAlive(status.hostPid))
        throw new Error('Obsidian 평가 호스트가 종료되었습니다.');
      if (Date.now() >= deadline) throw new Error('Obsidian 평가 대기 시간이 초과되었습니다.');
      if (status && Date.now() - lastProgress >= 30_000) {
        console.log(
          JSON.stringify({
            completed: status.completed,
            total: status.total,
            passed: status.passed,
          }),
        );
        lastProgress = Date.now();
      }
      await wait(500);
    }
    if (!status.completed)
      throw new Error(`실제 볼트 평가 실패: 단계=${status.stage}, HTTP=${status.status ?? '없음'}`);
    const report = JSON.parse(await readFile(output, 'utf8'));
    console.log(JSON.stringify(report, null, 2));
    if (report.failed > 0) process.exitCode = 1;
    await rm(directory, { recursive: true, force: true });
    process.exit(process.exitCode ?? 0);
  }
  const current = await evaluate(runtime, settings);
  const report = {
    version: fixture.version,
    mode: settings ? 'live' : 'offline',
    model: settings?.chat.defaultModel ?? null,
    reviewCriteria: fixture.reviewCriteria,
    note: '자동 값은 계약·키워드 관측값입니다. 실제 답변의 정확성·완결성은 원문과 함께 별도 검토해야 합니다.',
    current,
  };
  const baselineRef = option('--compare-ref');
  if (baselineRef) {
    const baselineDirectory = path.join(directory, 'baseline');
    await mkdir(baselineDirectory);
    const archive = path.join(directory, 'baseline.tar');
    execFileSync('git', ['archive', `--output=${archive}`, baselineRef], { cwd: repository });
    execFileSync('tar', ['-xf', archive, '-C', baselineDirectory]);
    report.baselineRef = baselineRef;
    report.baseline = await evaluate(
      await compileRuntime(baselineDirectory, baselineDirectory),
      settings,
    );
  }
  const output = option('--output');
  if (output) await writeFile(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        mode: report.mode,
        model: report.model,
        executions: current.length,
        passed: current.filter((item) => item.contractPassed).length,
        failed: current.filter((item) => !item.contractPassed).length,
        failures: current
          .filter((item) => !item.contractPassed)
          .map(({ id, protocol, contractPassed, elapsedMs, providerCalls, toolCalls }) => ({
            id,
            protocol,
            contractPassed,
            elapsedMs,
            providerCalls,
            toolCalls,
          })),
        baseline: report.baseline?.map(({ id, contractPassed }) => ({ id, contractPassed })),
        output: output ?? null,
      },
      null,
      2,
    ),
  );
  if (current.some((result) => !result.contractPassed)) process.exitCode = 1;
} catch (error) {
  // provider 응답·헤더·자격 증명은 오류 출력에 넣지 않습니다.
  console.error(
    !option('--settings') && !option('--obsidian-vault')
      ? error.message
      : error.message?.startsWith('설정') || error.message?.startsWith('선택 모델')
        ? error.message
        : '품질 평가 실행에 실패했습니다. 원문 응답이나 자격 증명은 출력하지 않았습니다.',
  );
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
