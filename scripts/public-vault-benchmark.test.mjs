import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import 'fake-indexeddb/auto';
import { compileRuntime } from './evaluate-chat-quality.mjs';
import {
  adaptQuestion,
  safeDocumentPath,
  summarize,
  selectQuestions,
  loadBenchmark,
  runtimeExports,
  classifyFailure,
  selectVerifiedCitationRanges,
  groundedSuccess,
  compareAnswers,
  validateGrade,
  validateResumeRows,
  answerBenchmark,
  diagnoseResponsibilities,
  summarizeOracle,
  collectOracleEvidence,
  providerBridge,
  benchmarkRoot,
  parseAnswerOptions,
  createBridgeExchange,
  parseEnterpriseArchiveEntries,
  prepareMultiHop,
  materializeCorpus,
  corpusScope,
  downloadDatasetFile,
  assertBenchmarkModel,
  benchmarkModelId,
} from './public-vault-benchmark.mjs';

function benchmarkSettings(profileId = 'synthetic') {
  return {
    chat: { defaultModel: `profile:${profileId}:deepseek/deepseek-v4.1-flash` },
    rag: {},
    providerProfiles: [
      {
        id: profileId,
        enabled: true,
        strategy: 'openAICompatible',
        baseUrl: 'https://api.commandcode.ai/v1',
        models: [{ id: 'deepseek/deepseek-v4.1-flash', kind: 'general' }],
      },
    ],
  };
}

test('벤치마크는 등록된 Command Code DS 모델만 허용하고 다른 서버·OAuth·모델은 거부한다', () => {
  const settings = benchmarkSettings();
  assert.equal(assertBenchmarkModel(settings), settings.chat.defaultModel);
  assert.equal(benchmarkModelId, 'deepseek/deepseek-v4.1-flash');
  for (const change of [
    { strategy: 'openAIChatGPT' },
    { enabled: false },
    { baseUrl: 'https://example.com/v1' },
    { baseUrl: 'http://api.commandcode.ai/v1' },
    { baseUrl: 'https://api.commandcode.ai.example.com/v1' },
    { baseUrl: 'https://credential@api.commandcode.ai/v1' },
    { models: [{ id: 'another-model', kind: 'general' }] },
  ]) {
    const changed = structuredClone(settings);
    Object.assign(changed.providerProfiles[0], change);
    assert.throws(() => assertBenchmarkModel(changed), /벤치마크 모델/);
  }
  assert.throws(
    () => assertBenchmarkModel(settings, 'profile:synthetic:another-model'),
    /벤치마크 모델/,
  );
});

test('허용되지 않는 생성 또는 판정 설정은 OAuth 초기화와 provider 생성 전에 차단한다', async () => {
  const settings = benchmarkSettings();
  let calls = 0;
  const app = {
    vault: { adapter: { getBasePath: () => path.dirname(benchmarkRoot) } },
    plugins: { plugins: { 'superpower-inside': { settings } } },
  };
  const runtime = {
    appLogger: { configure() {} },
    initializeChatGPTOAuth: () => calls++,
    createProviderForStrategy: () => calls++,
  };
  await assert.rejects(
    providerBridge(runtime, app, 'unused', 1000, undefined, 'profile:synthetic:other'),
    /벤치마크 모델/,
  );
  settings.providerProfiles[0].strategy = 'openAIChatGPT';
  await assert.rejects(providerBridge(runtime, app, 'unused'), /벤치마크 모델/);
  assert.equal(calls, 0);
});

test('공식 압축 목록은 OS별 줄바꿈을 처리하고 볼트 밖 경로를 거부한다', () => {
  assert.deepEqual(parseEnterpriseArchiveEntries('synthetic/a.txt\r\nsynthetic/b.txt\r\n'), [
    'synthetic/a.txt',
    'synthetic/b.txt',
  ]);
  for (const entry of [
    '/outside.txt',
    '../outside.txt',
    'a/../outside.txt',
    'a\\outside.txt',
    'C:/outside.txt',
  ]) {
    assert.throws(() => parseEnterpriseArchiveEntries(entry), /압축 경로/);
  }
});

test('전송 중인 응답 JSON이 잠시 불완전해도 재독해 완성된 응답만 받는다', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'benchmark-partial-response-'));
  try {
    await writeFile(path.join(directory, 'response.json'), '{');
    const exchange = createBridgeExchange(directory, { hostPid: process.pid });
    const request = exchange({ operation: 'native-status' });
    await wait(150);
    await writeFile(
      path.join(directory, 'response.json'),
      JSON.stringify({ id: 1, result: { ready: false }, error: false }),
    );
    assert.deepEqual((await request).result, { ready: false });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('다운로드 캐시는 같은 버전의 체크섬이 일치할 때만 재사용한다', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'benchmark-download-'));
  const fetch = globalThis.fetch;
  const { createHash } = await import('node:crypto');
  const text = '합성 공개 자료';
  const digest = createHash('sha256').update(text).digest('hex');
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(text);
  };
  try {
    const filename = path.join(root, 'raw.json');
    await downloadDatasetFile('https://example.com/pinned', filename, undefined, digest);
    await downloadDatasetFile('https://example.com/pinned', filename, undefined, digest);
    assert.equal(calls, 1);
    await writeFile(filename, '손상된 합성 자료');
    await downloadDatasetFile('https://example.com/pinned', filename, undefined, digest);
    assert.equal(calls, 2);
    assert.equal(await readFile(filename, 'utf8'), text);
  } finally {
    globalThis.fetch = fetch;
    await rm(root, { recursive: true, force: true });
  }
});

test('기본 워크플로우는 전체 핵심 질문을 3회 평가하며 작은 표본은 명시적으로 선택한다', () => {
  assert.deepEqual(parseAnswerOptions([]), {
    dataset: 'wix',
    count: undefined,
    source: undefined,
    runId: 'full',
    repeats: 3,
    oracle: false,
    diagnostic: false,
    includeSynthetic: false,
  });
  assert.equal(parseAnswerOptions(['multihop']).count, undefined);
  assert.throws(() => parseAnswerOptions(['enterprise']));
  assert.equal(parseAnswerOptions(['wix', '12', '-', 'smoke', '1']).count, 12);
  assert.equal(
    parseAnswerOptions(['wix', 'all', '-', 'full', '3', 'diagnostic', '--include-synthetic'])
      .includeSynthetic,
    true,
  );
  assert.throws(() => parseAnswerOptions(['wix', '0']));
  assert.throws(() => parseAnswerOptions(['wix', '12', '-', 'run', '0']));
});

test('전체 답변 실행에서도 독립 판정자 옵션을 전달하고 중복·잘못된 참조는 거부한다', () => {
  const judge = '--judge-model=profile:judge:synthetic-model';
  assert.equal(
    parseAnswerOptions(['wix', 'all', '-', 'full', '3', judge]).judgeModel,
    'profile:judge:synthetic-model',
  );
  assert.equal(parseAnswerOptions([judge]).count, undefined);
  assert.throws(() => parseAnswerOptions([judge, judge]));
  assert.throws(() => parseAnswerOptions(['--judge-model=invalid']));
});

test('생성과 판정은 같은 Command Code DS 모델을 사용하며 OAuth를 초기화하지 않는다', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'benchmark-judge-'));
  const calls = [];
  const settings = benchmarkSettings();
  try {
    await writeFile(
      path.join(directory, 'request.json'),
      JSON.stringify({
        id: 1,
        role: 'judge',
        messages: [],
      }),
    );
    await providerBridge(
      {
        appLogger: { configure() {} },
        initializeChatGPTOAuth() {
          throw new Error('벤치마크 OAuth 사용 금지');
        },
        resolveUsableProviderModelRef: () => null,
        createProviderForStrategy: (_strategy, _profile, model) => ({
          async streamChat(_messages, onChunk) {
            calls.push(model);
            onChunk({ content: '합성 판정' });
            await writeFile(path.join(directory, 'stop'), '중단');
          },
        }),
      },
      {
        vault: { adapter: { getBasePath: () => path.dirname(benchmarkRoot) } },
        plugins: { plugins: { 'superpower-inside': { settings, manifest: { version: 'test' } } } },
      },
      directory,
      1000,
      undefined,
      settings.chat.defaultModel,
    );
    assert.deepEqual(calls, ['deepseek/deepseek-v4.1-flash']);
    assert.equal(settings.chat.defaultModel, 'profile:synthetic:deepseek/deepseek-v4.1-flash');
    const response = JSON.parse(await readFile(path.join(directory, 'response.json'), 'utf8'));
    assert.equal(response.error, false);
    assert.equal(response.chunks[0].content, '합성 판정');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('실제 모델 연결에서 검색 임계값을 보존하고 인증 설정을 출력하지 않는다', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'benchmark-provider-'));
  try {
    await writeFile(path.join(directory, 'stop'), '중단');
    const settings = benchmarkSettings();
    settings.rag = { chunkSize: 1000, overlap: 100, minScore: 0.3 };
    settings.providerProfiles[0].apiKey = '합성 키';
    await providerBridge(
      {
        appLogger: { configure: () => {} },
        initializeChatGPTOAuth: () => {},
        createProviderForStrategy: () => ({ capability: {}, contextBudget: {} }),
        resolveUsableProviderModelRef: () => null,
      },
      {
        vault: { adapter: { getBasePath: () => path.dirname(benchmarkRoot) } },
        plugins: { plugins: { 'superpower-inside': { settings, manifest: { version: 'test' } } } },
      },
      directory,
    );
    const metadata = JSON.parse(await readFile(path.join(directory, 'provider.json'), 'utf8'));
    assert.equal(metadata.settings.rag.minScore, 0.3);
    assert.equal(JSON.stringify(metadata).includes('합성 키'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('provider가 취소 신호에 응답하지 않아도 벤치마크 연결은 시간 초과를 반환한다', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'benchmark-timeout-'));
  try {
    await writeFile(path.join(directory, 'request.json'), JSON.stringify({ id: 1, messages: [] }));
    await providerBridge(
      {
        appLogger: { configure: () => {} },
        initializeChatGPTOAuth: () => {},
        resolveUsableProviderModelRef: () => null,
        createProviderForStrategy: () => ({
          streamChat: async () => {
            await writeFile(path.join(directory, 'stop'), '중단');
            await new Promise(() => {});
          },
        }),
      },
      {
        vault: { adapter: { getBasePath: () => path.dirname(benchmarkRoot) } },
        plugins: {
          plugins: {
            'superpower-inside': {
              settings: benchmarkSettings(),
              manifest: { version: 'test' },
            },
          },
        },
      },
      directory,
      20,
    );
    const response = JSON.parse(await readFile(path.join(directory, 'response.json'), 'utf8'));
    assert.equal(response.id, 1);
    assert.equal(response.error, 'timeout');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('동시 검색 임베딩 요청과 답변 요청을 순서대로 전달하고 실패 뒤에도 이어간다', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'benchmark-concurrent-'));
  const requests = [];
  let server;
  try {
    const exchange = createBridgeExchange(directory, { hostPid: process.pid });
    server = providerBridge(
      {
        appLogger: { configure: () => {} },
        initializeChatGPTOAuth: () => {},
        resolveUsableProviderModelRef: () => ({
          profile: { id: 'local', strategy: 'ternlight' },
          modelId: 'ternlight-base',
        }),
        TernlightEmbeddingProvider: class {
          async embed(text) {
            requests.push(text);
            await wait(20);
            return [1, 0];
          }
          async embedBatch(texts) {
            requests.push(...texts);
            return texts.map(() => [0, 1]);
          }
          close() {
            requests.push('closed');
          }
        },
        createProviderForStrategy: () => ({
          streamChat: async (messages, onChunk) => {
            requests.push(messages[0].content);
            onChunk({ content: '합성 답변' });
          },
        }),
      },
      {
        vault: { adapter: { getBasePath: () => path.dirname(benchmarkRoot) } },
        plugins: {
          plugins: {
            'superpower-inside': {
              settings: benchmarkSettings('test'),
              manifest: { version: 'test' },
            },
          },
        },
      },
      directory,
    );
    const responses = await Promise.all([
      exchange({ operation: 'embedding', kind: 'query', texts: ['질의 하나'] }),
      exchange({ operation: 'embedding', kind: 'document', texts: ['문서 하나'] }),
      exchange({ messages: [{ role: 'user', content: '질문 하나' }] }),
    ]);
    assert.deepEqual(
      responses.map((row) => row.id),
      [1, 2, 3],
    );
    assert.deepEqual(requests, ['질의 하나', '문서 하나', '질문 하나']);
    assert.deepEqual(responses[0].vectors, [[1, 0]]);
    assert.deepEqual(responses[1].vectors, [[0, 1]]);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(exchange({ messages: [] }, controller.signal), /시간 초과/);
    assert.equal((await exchange({ messages: [{ role: 'user', content: '다음 질문' }] })).id, 4);
    await writeFile(path.join(directory, 'stop'), '중단');
    await server;
    assert.equal(requests.at(-1), 'closed');
  } finally {
    await writeFile(path.join(directory, 'stop'), '중단');
    await server;
    await rm(directory, { recursive: true, force: true });
  }
});

test('검증된 검색 구간을 읽기 없이도 근거로 인정하고 요청 예산에서 빠진 근거는 구분한다', () => {
  const row = {
    mode: 'loop',
    expectedPaths: ['a', 'b'],
    retrievedPaths: ['a', 'b'],
    evidenceCitations: [
      { filePath: 'a', status: 'verified' },
      { filePath: 'b', status: 'candidate' },
    ],
    forwardedCitationPaths: ['a'],
    grade: { ...successfulGrade, complete: false },
  };
  const result = diagnoseResponsibilities(row);
  assert.equal(result.retrievedExpectedCount, 2);
  assert.equal(result.verifiedExpectedCount, 1);
  assert.equal(result.forwardedExpectedCount, 1);
  assert.equal(result.focus, 'retrieval-and-tool-strategy');
  assert.equal(
    diagnoseResponsibilities({
      ...row,
      evidenceCitations: [
        { filePath: 'a', status: 'verified' },
        { filePath: 'b', status: 'verified' },
      ],
    }).focus,
    'evidence-delivery',
  );
  assert.equal(
    diagnoseResponsibilities({ ...row, expectedPaths: [], category: 'high_level' }).focus,
    'answer-generation',
  );
});

test('정답 문서 제공 실험을 일반 비교에서 제외하고 회복 가능한 실패만 별도 집계한다', () => {
  const rows = [
    { id: 'a', repeat: 0, mode: 'bm25', grade: { ...successfulGrade, complete: false } },
    { id: 'a', repeat: 0, mode: 'loop', grade: { ...successfulGrade, correct: false } },
    { id: 'a', repeat: 0, mode: 'oracle', grade: successfulGrade },
    { id: 'b', repeat: 0, mode: 'oracle', notApplicable: true },
  ];
  assert.equal(compareAnswers(rows).unpairedExecutions, 0);
  assert.equal(summarizeOracle(rows).recoverableFailures.loop, 1);
  assert.equal(summarizeOracle(rows).recoverableFailures.bm25, 1);
  assert.equal(summarizeOracle(rows).notApplicable, 1);
  assert.equal(summarize(rows).oracle.total, 1);
});

test('정답 문서의 잘린 읽기를 이어가며 반환 cursor를 그대로 사용한다', async () => {
  const requests = [];
  const native = {
    execute: async (raw) => {
      const args = JSON.parse(raw);
      requests.push(args);
      return {
        modelText: JSON.stringify({
          content: '합성 원문',
          truncated: requests.length === 1,
          nextStartLine: 1,
          nextStartOffset: 7,
        }),
        citations: [{ filePath: args.path, status: 'verified' }],
      };
    },
  };
  const result = await collectOracleEvidence(native, ['a']);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].start_line, 1);
  assert.equal(requests[1].start_offset, 7);
  assert.deepEqual(result.readPaths, ['a']);
});

const successfulGrade = { correct: true, complete: true, supported: true, abstained: false };

test('미확인 인용·도구 계약 위반·잘못된 답변 유보는 판정자가 승인해도 성공이 아니다', () => {
  const row = { grade: successfulGrade, category: 'qa' };
  assert.equal(groundedSuccess(row), true);
  assert.equal(groundedSuccess({ ...row, invalidCitationCount: 1 }), false);
  assert.equal(groundedSuccess({ ...row, violations: ['missing-source'] }), false);
  assert.equal(groundedSuccess({ ...row, terminal: 'round-limit' }), false);
  assert.equal(groundedSuccess({ ...row, grade: { ...successfulGrade, abstained: true } }), false);
  assert.equal(
    groundedSuccess({
      ...row,
      category: 'info_not_found',
      grade: { ...successfulGrade, abstained: true },
    }),
    true,
  );
});

test('읽기와 의미적 근거 충족을 분리하고 과도한 답변 유보의 분모를 유지한다', () => {
  const report = summarize([
    {
      id: 'a',
      mode: 'loop',
      category: 'qa',
      expectedPaths: ['a', 'b'],
      readPaths: ['a', 'b'],
      grade: { ...successfulGrade, complete: false },
    },
    { id: 'b', mode: 'loop', category: 'qa', grade: { ...successfulGrade, abstained: true } },
    {
      id: 'c',
      mode: 'loop',
      category: 'info_not_found',
      grade: { ...successfulGrade, abstained: true },
    },
    { id: 'd', mode: 'loop', category: 'qa', error: 'timeout' },
  ]).loop;
  assert.equal(report.multiNoteAllRead, 1);
  assert.equal(report.multiNoteGroundedSuccessRate, 0);
  assert.equal(report.answerableTotal, 3);
  assert.equal(report.answerableUnjudged, 1);
  assert.equal(report.citationSupportedAnswerRate, 1 / 3);
  assert.equal(report.overRefusalRate, 1 / 3);
  assert.equal(report.unanswerableTotal, 1);
  assert.equal(report.correctAbstentionRate, 1);
});

test('같은 질문의 쌍만 비교하고 실패를 유지하며 유형별 개선과 불확실성을 계산한다', () => {
  const rows = [
    { id: 'a', mode: 'bm25', category: 'qa', configuration: 'expert', error: 'timeout' },
    { id: 'a', mode: 'loop', category: 'qa', configuration: 'expert', grade: successfulGrade },
    { id: 'b', mode: 'bm25', category: 'qa', configuration: 'expert', grade: successfulGrade },
    {
      id: 'b',
      mode: 'loop',
      category: 'qa',
      configuration: 'expert',
      grade: { ...successfulGrade, correct: false },
    },
    { id: 'c', mode: 'loop', category: 'qa', configuration: 'expert', grade: successfulGrade },
  ];
  const result = compareAnswers(rows);
  assert.equal(result.pairedQuestions, 2);
  assert.equal(result.unpairedExecutions, 1);
  assert.equal(result.deltaPercentagePoints, 0);
  assert.equal(result.wins, 1);
  assert.equal(result.losses, 1);
  assert.equal(result.groups['expert/qa'].deltaPercentagePoints, 0);
  assert.ok(result.delta95Interval[0] < 0);
  assert.ok(result.delta95Interval[1] > 0);
  assert.deepEqual(result, compareAnswers([...rows].reverse()));
  assert.equal(compareAnswers([]).deltaPercentagePoints, null);
});

test('동일 질문의 반복 실행을 독립 질문 수로 부풀리지 않는다', () => {
  const rows = [0, 1, 2].flatMap((repeat) => [
    { id: 'a', repeat, mode: 'bm25', grade: successfulGrade },
    { id: 'a', repeat, mode: 'loop', grade: successfulGrade },
  ]);
  const result = compareAnswers(rows);
  assert.equal(result.pairedQuestions, 1);
  assert.equal(result.pairedExecutions, 3);
  assert.equal(result.delta95Interval, null);
});

test('재개 시 표본 밖·중복·다른 반복 실행 결과를 거부한다', () => {
  const selected = [{ id: 'a' }];
  assert.doesNotThrow(() =>
    validateResumeRows([{ id: 'a', repeat: 0, mode: 'loop' }], selected, 1),
  );
  assert.throws(() => validateResumeRows([{ id: 'b', repeat: 0, mode: 'loop' }], selected, 1));
  assert.throws(() => validateResumeRows([{ id: 'a', repeat: 1, mode: 'loop' }], selected, 1));
  assert.throws(() => validateResumeRows([{ id: 'a', mode: 'loop' }], selected, 1));
  assert.throws(() =>
    validateResumeRows(
      [
        { id: 'a', repeat: 0, mode: 'loop' },
        { id: 'a', repeat: 0, mode: 'loop' },
      ],
      selected,
      1,
    ),
  );
});

test('판정 스키마를 엄격히 확인하고 하나라도 읽지 않은 인용이 있으면 근거 판정을 실패시킨다', () => {
  const citations = [{ filePath: 'Example.md', line: 1, endLine: 10, status: 'verified' }];
  const row = {
    answer: '사실 [vault:Example.md:1-3] 다른 사실 [vault:Unknown.md:1-3]',
    category: 'qa',
  };
  const result = validateGrade(JSON.stringify(successfulGrade), row, citations);
  assert.equal(result.grade.supported, false);
  assert.equal(result.invalidCitationCount, 1);
  assert.throws(() => validateGrade('{"correct":true}', row, citations));
  assert.equal(
    validateGrade(
      JSON.stringify({ ...successfulGrade, abstained: true }),
      { answer: '자료가 없습니다.', category: 'info_not_found' },
      [],
    ).grade.supported,
    true,
  );
  assert.equal(
    validateGrade(
      JSON.stringify(successfulGrade),
      { answer: '알 수 있습니다.', category: 'high_level' },
      [],
    ).grade.supported,
    false,
  );
});

test('실제로 확인한 범위 안의 세부 인용을 인정하고 범위 밖 인용은 거부한다', () => {
  const citations = [
    {
      id: 'vault:Example.md:1-20',
      filePath: 'Example.md',
      line: 1,
      endLine: 20,
      status: 'verified',
    },
    {
      id: 'vault:Unread.md:1-20',
      filePath: 'Unread.md',
      line: 1,
      endLine: 20,
      status: 'candidate',
    },
  ];
  const selected = selectVerifiedCitationRanges(
    '[vault:Example.md:5-10] [vault:Example.md:15-30] [vault:Unread.md:5-10]',
    citations,
  );
  assert.equal(selected.length, 1);
  assert.equal(selected[0].line, 5);
  assert.equal(selected[0].endLine, 10);
});

test('인증 정보가 포함될 수 있는 오류 원문을 반환하지 않는다', () => {
  assert.equal(classifyFailure(new Error('429 quota secret-example')), 'usage_limit');
  assert.equal(classifyFailure(new Error('401 token secret-example')), 'authentication');
  assert.equal(classifyFailure(new Error('Obsidian이 종료되었습니다.')), 'host_closed');
  assert.equal(classifyFailure(new Error('선택 모델 응답 시간 초과')), 'timeout');
  assert.equal(classifyFailure({ status: 429, message: '합성 오류' }), 'usage_limit');
  assert.equal(classifyFailure({ status: 401, message: '합성 오류' }), 'authentication');
  assert.equal(classifyFailure({ status: 503, message: '합성 오류' }), 'http_503');
  assert.equal(classifyFailure(new Error('unknown secret-example')), 'provider_or_runtime');
  assert.equal(classifyFailure(new Error('벤치마크 모델 제한: 합성 오류')), 'benchmark_model');
  assert.equal(
    classifyFailure(new Error('선택 모델 요청 실패: benchmark_model')),
    'benchmark_model',
  );
  assert.equal(
    classifyFailure(new Error('제품 설정이 실행 중 변경되었습니다.')),
    'configuration_changed',
  );
  assert.equal(
    classifyFailure(new Error('선택 모델 요청 실패: configuration_changed')),
    'configuration_changed',
  );
});

test('문서 경로에 원본 식별자를 직접 삽입하지 않는다', () => {
  assert.match(
    safeDocumentPath('../escape', 'wix'),
    /^Benchmarks\/WixQA\/Corpus\/[a-f0-9]{2}\/[a-f0-9]{64}\.md$/,
  );
  assert.equal(safeDocumentPath('a', 'wix'), safeDocumentPath('a', 'wix'));
  assert.notEqual(safeDocumentPath('a', 'wix'), safeDocumentPath('b', 'wix'));
});

test('다중 문서 자료는 메타데이터와 본문만 공개하고 정답 근거는 판정 자료에 분리한다', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'multihop-synthetic-'));
  try {
    const raw = path.join(root, 'datasets/multihop/raw');
    await mkdir(raw, { recursive: true });
    const documents = ['first', 'second'].map((id) => ({
      title: `합성 ${id}`,
      author: '합성 작성자',
      source: '합성 출처',
      published_at: '2025-01-01',
      url: `https://example.com/${id}`,
      body: `독립 합성 본문 ${id}`,
    }));
    await writeFile(path.join(raw, 'corpus.json'), JSON.stringify(documents));
    await writeFile(
      path.join(raw, 'MultiHopRAG.json'),
      JSON.stringify([
        {
          query: '합성 비교 질문',
          answer: '비공개 합성 정답',
          question_type: 'comparison_query',
          evidence_list: documents.map((d) => ({ url: d.url, fact: '판정 전용 합성 사실' })),
        },
        {
          query: '합성 정보 부재 질문',
          answer: '정보 없음',
          question_type: 'null_query',
          evidence_list: [],
        },
      ]),
    );
    await prepareMultiHop(root);
    const manifest = [];
    for await (const item of (await import('./public-vault-benchmark.mjs')).jsonLines(
      path.join(root, 'datasets/multihop/documents.jsonl'),
    ))
      manifest.push(item);
    assert.equal(manifest.length, 2);
    const text = await readFile(
      path.join(root, 'datasets/multihop/documents', manifest[0].path),
      'utf8',
    );
    assert.match(text, /합성 작성자/);
    assert.match(text, /2025-01-01/);
    assert.match(text, /독립 합성 본문/);
    assert.doesNotMatch(text, /판정 전용|비공개 합성 정답/);
    const qa = [];
    for await (const item of (await import('./public-vault-benchmark.mjs')).jsonLines(
      path.join(root, 'datasets/multihop/raw/questions.jsonl'),
    ))
      qa.push(adaptQuestion(item, 'multihop'));
    assert.equal(qa[0].expectedPaths.length, 2);
    assert.equal(qa[1].category, 'info_not_found');
    assert.deepEqual(qa[1].expectedPaths, []);
    const vault = path.join(root, 'vault');
    await materializeCorpus('multihop', root, vault);
    assert.equal(await readFile(path.join(vault, manifest[0].path), 'utf8'), text);
    assert.equal(corpusScope('multihop'), 'Benchmarks/MultiHop-RAG/Corpus');
    assert.equal(parseAnswerOptions(['multihop']).dataset, 'multihop');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('정답 근거와 질문을 분리하고 필수 문서 전체를 유지한다', () => {
  const item = adaptQuestion({ question: '질문', answer: '정답', article_ids: ['1', '2'] }, 'wix');
  assert.equal(item.reference, '정답');
  assert.equal(item.expectedPaths.length, 2);
  assert.equal(item.question, '질문');
});

test('모델 실패를 분모에 포함하고 미판정 답변을 성공으로 세지 않는다', () => {
  const result = summarize([
    { mode: 'loop', elapsedMs: 10, grade: { correct: true, complete: true, supported: true } },
    { mode: 'loop', elapsedMs: 20, error: '실패' },
    { mode: 'loop', elapsedMs: 30 },
  ]);
  assert.equal(result.loop.total, 3);
  assert.equal(result.loop.groundedSuccess, 1);
  assert.equal(result.loop.groundedSuccessRate, 1 / 3);
  assert.equal(result.loop.judged, 1);
});

test('순서로 쉬운 질문을 고르지 않고 각 질문 묶음을 포함한다', () => {
  const questions = [
    { id: 'a', configuration: 'expert', category: 'qa' },
    { id: 'b', configuration: 'expert', category: 'qa' },
    { id: 'c', configuration: 'simulated', category: 'qa' },
  ];
  const selected = selectQuestions(questions, 2);
  assert.deepEqual(new Set(selected.map((q) => q.configuration)), new Set(['expert', 'simulated']));
  assert.deepEqual(
    selected,
    selectQuestions([...questions].reverse(), 2).sort((a, b) =>
      a.configuration.localeCompare(b.configuration),
    ),
  );
  assert.throws(() => selectQuestions(questions, 0));
  assert.throws(() => selectQuestions([], 1));
});

test('실제 제품 색인과 도구로 합성 문서를 검색하고 인용 가능한 원문을 읽는다', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'public-benchmark-'));
  let data;
  try {
    const documentPath = safeDocumentPath('synthetic-id', 'wix');
    const directory = path.join(root, 'datasets/wix');
    await mkdir(path.dirname(path.join(directory, 'documents', documentPath)), { recursive: true });
    await writeFile(
      path.join(directory, 'documents', documentPath),
      '# 합성 문서\n\n바나나의 가격은 900원입니다.',
    );
    await writeFile(
      path.join(directory, 'documents.jsonl'),
      JSON.stringify({ path: documentPath }) + '\n',
    );
    for (const configuration of ['wixqa_expertwritten', 'wixqa_simulated', 'wixqa_synthetic']) {
      await mkdir(path.join(directory, 'raw', configuration), { recursive: true });
      await writeFile(
        path.join(directory, 'raw', configuration, 'test.jsonl'),
        JSON.stringify({
          question: '바나나의 가격은?',
          answer: '정답표에서만 확인할 수 있는 합성 판정 문구',
          article_ids: ['synthetic-id'],
        }) + '\n',
      );
    }
    const runtime = await compileRuntime(process.cwd(), root, runtimeExports);
    assert.match(runtime.evaluationFingerprint, /^[a-f0-9]{64}$/);
    runtime.appLogger.configure({ mirrorToConsole: false, minLevel: 'fatal' });
    globalThis.window ??= globalThis;
    data = await loadBenchmark(runtime, 'wix', root);
    const native = new runtime.NativeVaultToolRuntime(
      new runtime.ObsidianNativeVaultToolPort(
        data.vault.app,
        {
          listCandidateFiles: async () => data.vault.files,
          isCandidateFile: async () => true,
          isPathVisible: () => true,
        },
        data.vault.getQueryEngine,
      ),
    );
    const search = await native.execute(
      JSON.stringify({ query: '바나나', limit: 10 }),
      undefined,
      'superpower_inside_search',
    );
    assert.ok(search.citations.some((c) => c.filePath === documentPath));
    const read = await native.execute(
      JSON.stringify({ path: documentPath, start_line: 1, end_line: 3 }),
      undefined,
      'superpower_inside_read',
    );
    assert.match(read.modelText, /900원/);
    assert.equal(read.citations[0].status, 'verified');
    assert.equal(data.questions.length, 3);
    const calls = [];
    const provider = {
      capability: { maxToolRounds: 1 },
      streamChat: async (messages, onChunk, temperature) => {
        const judging = messages[0].content.includes('독립 평가자');
        calls.push({ judging, temperature, messages });
        onChunk({
          content: judging
            ? JSON.stringify(successfulGrade)
            : `900원입니다. [vault:${documentPath}:3-3]`,
        });
      },
      chat: async () => 'banana price',
    };
    const app = {
      vault: { adapter: { getBasePath: () => path.dirname(root) } },
      plugins: {
        plugins: {
          'superpower-inside': {
            settings: { ...benchmarkSettings(), rag: { chunkSize: 2000, overlap: 200 } },
            manifest: { version: '0.0.0-test' },
          },
        },
      },
    };
    const embeddingCalls = [];
    const embeddingProvider = {
      identity: { provider: 'synthetic', model: 'synthetic-vector' },
      embed: async (text) => {
        embeddingCalls.push({ kind: 'query', text });
        return [1, 0];
      },
      embedBatch: async (texts) => {
        embeddingCalls.push({ kind: 'document', texts });
        return texts.map(() => [1, 0]);
      },
    };
    const options = { root, provider, embeddingProvider, count: 1, repeats: 2 };
    await assert.rejects(
      answerBenchmark(runtime, app, { ...options, embeddingProvider: undefined }),
      /임베딩/,
    );
    const report = await answerBenchmark(runtime, app, options);
    assert.equal(report.availableQuestions, 2);
    assert.deepEqual(report.specification.modes, ['bm25', 'product']);
    assert.deepEqual(report.specification.embedding, embeddingProvider.identity);
    assert.equal(report.comparison.candidateMode, 'product');
    assert.ok(embeddingCalls.some((call) => call.kind === 'document'));
    assert.ok(embeddingCalls.some((call) => call.kind === 'query'));
    assert.equal(report.plannedExecutions, 4);
    assert.equal(report.comparison.pairedQuestions, 1);
    assert.equal(report.comparison.pairedExecutions, 2);
    assert.equal(report.summary.bm25.groundedSuccess, 2);
    assert.equal(report.summary.product.total, 2);
    assert.equal(report.summary.loop, undefined);
    assert.equal(report.publicClaims.ready, false);
    assert.ok(calls.filter((c) => c.judging).every((c) => c.temperature === 0));
    assert.ok(calls.filter((c) => !c.judging).every((c) => c.temperature === 0.7));
    const review = JSON.parse(
      (await readFile(path.join(root, 'runs/wix-answers-review.jsonl'), 'utf8')).trim(),
    );
    assert.equal(review.candidates.length, 4);
    assert.ok(review.candidates.every((c) => !('mode' in c)));
    const previousCalls = calls.length;
    const previousDocumentBatches = embeddingCalls.filter(
      (call) => call.kind === 'document',
    ).length;
    await answerBenchmark(runtime, app, options);
    assert.equal(calls.length, previousCalls);
    assert.equal(
      embeddingCalls.filter((call) => call.kind === 'document').length,
      previousDocumentBatches,
    );
    const diagnostic = await answerBenchmark(runtime, app, {
      ...options,
      oracle: true,
      diagnostic: true,
      runLabel: '-diagnostic',
    });
    assert.equal(diagnostic.plannedExecutions, 8);
    assert.equal(diagnostic.productComparison.candidateMode, 'product');
    assert.equal(diagnostic.productComparison.pairedExecutions, 2);
    assert.equal(diagnostic.comparison.unpairedExecutions, 0);
    assert.equal(diagnostic.responsibilityDiagnostics.oracle.recoverableFailures.loop, 2);
    assert.equal(diagnostic.summary.oracle.groundedSuccess, 2);
    assert.ok(
      calls
        .filter((call) => !call.judging)
        .every(
          (call) =>
            !JSON.stringify(call.messages).includes('정답표에서만 확인할 수 있는 합성 판정 문구'),
        ),
    );
    const diagnosticRows = (
      await readFile(path.join(root, 'runs/wix-diagnostic-answers.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.ok(
      diagnosticRows
        .filter((row) => row.mode === 'oracle')
        .every((row) => row.responsibility.forwardedExpectedCount === 1),
    );
    assert.ok(
      diagnosticRows
        .filter((row) => row.mode === 'product')
        .every(
          (row) =>
            row.initialContext.citations.length > 0 &&
            row.retrievalDiagnostics.some((item) => item.source === 'vector') &&
            row.retrievalDiagnostics.some((item) => item.source === 'bm25'),
        ),
    );
    assert.ok(
      calls.some(
        (call) =>
          !call.judging &&
          call.messages[0].content.includes('900원') &&
          call.messages[0].content.includes('Source'),
      ),
    );
    assert.ok(
      diagnosticRows
        .filter((row) => row.mode === 'loop')
        .every((row) => row.requestObservations.length > 0),
    );
    const combined = await answerBenchmark(runtime, app, {
      ...options,
      runLabel: '-combined',
      repeats: 1,
      provider: {
        ...provider,
        capability: { maxToolRounds: 3 },
        streamChat: async (messages, onChunk, temperature, tools) => {
          const executed = messages.filter((message) => message.role === 'tool').length;
          if (tools && executed < 2) {
            onChunk({
              toolCalls: [
                {
                  index: 0,
                  id: `synthetic-${executed}`,
                  function: {
                    name: executed === 0 ? 'superpower_inside_search' : 'superpower_inside_read',
                    arguments: JSON.stringify(
                      executed === 0
                        ? { query: '바나나', limit: 5 }
                        : { path: documentPath, start_line: 3, end_line: 3 },
                    ),
                  },
                },
              ],
            });
          } else
            onChunk({
              content: messages[0].content.includes('독립 평가자')
                ? JSON.stringify(successfulGrade)
                : `900원입니다. [vault:${documentPath}:3-3]`,
            });
        },
      },
    });
    assert.equal(combined.summary.product.groundedSuccess, 1);
    const combinedRows = (
      await readFile(path.join(root, 'runs/wix-combined-answers.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map(JSON.parse);
    const product = combinedRows.find((row) => row.mode === 'product');
    assert.equal(product.toolCalls, 2);
    assert.ok(product.readPaths.includes(documentPath));
    const degraded = await answerBenchmark(runtime, app, {
      ...options,
      runLabel: '-degraded',
      repeats: 1,
      embeddingProvider: {
        ...embeddingProvider,
        embed: async () => {
          throw new Error('합성 임베딩 실패');
        },
      },
    });
    assert.equal(degraded.summary.product.groundedSuccess, 0);
    assert.equal(degraded.summary.product.errors, 1);
    await assert.rejects(answerBenchmark(runtime, app, { ...options, count: 2 }), /평가 조건/);
    await assert.rejects(answerBenchmark(runtime, app, { ...options, repeats: 3 }), /평가 조건/);
    await assert.rejects(
      answerBenchmark(runtime, app, {
        ...options,
        runLabel: '-host-closed',
        provider: {
          ...provider,
          streamChat: async () => {
            throw new Error('Obsidian이 종료되었습니다.');
          },
        },
      }),
      /Obsidian이 종료/,
    );
    assert.equal(
      await readFile(path.join(root, 'runs/wix-host-closed-answers.jsonl'), 'utf8').catch(() => ''),
      '',
    );
    await writeFile(
      path.join(directory, 'documents', documentPath),
      '# 다른 합성 자료\n\n새로운 근거입니다.',
    );
    await assert.rejects(answerBenchmark(runtime, app, options), /평가 조건/);
  } finally {
    await data?.index.deleteDatabase();
    await rm(root, { recursive: true, force: true });
  }
});
