#!/usr/bin/env node

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(
  await readFile(path.join(repository, 'tests/fixtures/chat-quality.json'), 'utf8'),
);

// 볼트 I/O만 합성 데이터로 치환하며 컨텍스트·도구·provider 구현은 그대로 번들합니다.
const obsidianAdapter = `
export class TFile {}
export class TFolder {}
export function normalizePath(value) { return value.replaceAll('\\\\', '/'); }
export function getAllTags(cache) {
  const frontmatter = cache.frontmatter?.tags;
  return [...(cache.tags?.map(item => item.tag) ?? []),
    ...(Array.isArray(frontmatter) ? frontmatter : typeof frontmatter === 'string' ? [frontmatter] : [])];
}
export async function requestUrl(options) {
  const response = await fetch(options.url, { method: options.method, headers: options.headers, body: options.body,
    signal: AbortSignal.timeout(120000) });
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, headers: Object.fromEntries(response.headers), text, json,
    arrayBuffer: new TextEncoder().encode(text).buffer };
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
    export { createProviderForStrategy } from './src/llm/providers';
    export { getEffectiveSystemPrompt } from './src/chat/prompt-library';
    export { setLanguage } from './src/i18n';
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
          }));
        },
      },
    ],
  });
  const runtime = (await import(pathToFileURL(outfile).href)).default;
  runtime.setLanguage('ko');
  return runtime;
}

function syntheticVault(runtime, test) {
  const files = test.files.map((item) =>
    Object.assign(new runtime.TFile(), {
      path: item.path,
      name: path.basename(item.path),
      basename: path.basename(item.path, '.md'),
      extension: 'md',
      content: `${item.prefix ?? ''}${(item.repeat ?? '').repeat(item.repeatCount ?? 0)}${item.text}`,
      stat: { ctime: 1, mtime: 2, size: 100 },
    }),
  );
  const folders = [
    ...new Set(files.map((file) => path.posix.dirname(file.path)).filter((value) => value !== '.')),
  ].map((value) =>
    Object.assign(new runtime.TFolder(), { path: value, name: path.basename(value) }),
  );
  const find = (value) => files.find((file) => file.path === value);
  return {
    files,
    app: {
      vault: {
        getFiles: () => files,
        getMarkdownFiles: () => files,
        getAbstractFileByPath: (value) =>
          find(value) ?? folders.find((folder) => folder.path === value) ?? null,
        cachedRead: async (file) => file.content,
      },
      metadataCache: {
        resolvedLinks: {},
        getFileCache: () => null,
        getFirstLinkpathDest: (value, source) =>
          find(value) ??
          find(`${value}.md`) ??
          find(`${path.posix.dirname(source)}/${value}.md`) ??
          null,
      },
    },
  };
}

async function evaluate(runtime, settings) {
  let provider;
  if (settings) {
    const parts = settings.chat.defaultModel.split(':');
    const profile = settings.providerProfiles.find(
      (item) => parts[0] === 'profile' && item.id === parts[1],
    );
    if (!profile?.enabled || !profile.models.some((item) => item.id === parts.slice(2).join(':'))) {
      throw new Error(
        '설정의 선택 모델을 사용할 수 없습니다. 평가를 위해 다른 모델을 선택하지 않습니다.',
      );
    }
    if (profile.strategy === 'openAIChatGPT') {
      throw new Error(
        '선택 모델은 Obsidian OAuth 저장소가 필요합니다. CLI 평가는 인증을 대체하지 않습니다.',
      );
    }
    provider = runtime.createProviderForStrategy(
      profile.strategy,
      { ...profile, models: profile.models.map((item) => item.id) },
      parts.slice(2).join(':'),
      profile.id,
    );
  }
  const results = [];
  for (const test of fixture.cases) {
    const start = performance.now();
    const { files, app } = syntheticVault(runtime, test);
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
  const current = await evaluate(await compileRuntime(repository, currentDirectory), settings);
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
        current: current.map(({ id, contractPassed, elapsedMs, providerCalls, toolCalls }) => ({
          id,
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
    !option('--settings')
      ? error.message
      : error.message?.startsWith('설정') || error.message?.startsWith('선택 모델')
        ? error.message
        : '품질 평가 실행에 실패했습니다. 원문 응답이나 자격 증명은 출력하지 않았습니다.',
  );
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
