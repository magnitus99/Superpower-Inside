import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
} from './public-vault-benchmark.mjs';

test('실제로 확인한 범위 안의 세부 인용을 인정하고 범위 밖 인용은 거부한다', () => {
  const citations = [
    { id: 'vault:Example.md:1-20', filePath: 'Example.md', line: 1, endLine: 20, status: 'verified' },
    { id: 'vault:Unread.md:1-20', filePath: 'Unread.md', line: 1, endLine: 20, status: 'candidate' },
  ];
  const selected = selectVerifiedCitationRanges(
    '[vault:Example.md:5-10] [vault:Example.md:15-30] [vault:Unread.md:5-10]', citations,
  );
  assert.equal(selected.length, 1);
  assert.equal(selected[0].line, 5);
  assert.equal(selected[0].endLine, 10);
});

test('인증 정보가 포함될 수 있는 오류 원문을 반환하지 않는다', () => {
  assert.equal(classifyFailure(new Error('429 quota secret-example')), 'usage_limit');
  assert.equal(classifyFailure(new Error('401 token secret-example')), 'authentication');
  assert.equal(classifyFailure(new Error('unknown secret-example')), 'provider_or_runtime');
});

test('문서 경로에 원본 식별자를 직접 삽입하지 않는다', () => {
  assert.match(safeDocumentPath('../escape', 'wix'), /^wix\/[a-f0-9]{64}\.md$/);
  assert.equal(safeDocumentPath('a', 'wix'), safeDocumentPath('a', 'wix'));
  assert.notEqual(safeDocumentPath('a', 'wix'), safeDocumentPath('b', 'wix'));
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
          answer: '900원',
          article_ids: ['synthetic-id'],
        }) + '\n',
      );
    }
    const runtime = await compileRuntime(process.cwd(), root, runtimeExports);
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
  } finally {
    await data?.index.deleteDatabase();
    await rm(root, { recursive: true, force: true });
  }
});
