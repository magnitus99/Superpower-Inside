import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareWix, safeDocumentPath, validateGrade } from './public-vault-benchmark.mjs';
import {
  nativeProductAnswer,
  summarizeNative,
  renderComparison,
  publicReferences,
  questionInterval,
  loadNativeCorpus,
  selectNativeCitationRanges,
} from './native-product-benchmark.mjs';

test('실제 제품의 새 채팅만 실행하고 기존 세션과 선택 모델을 보존한다', async () => {
  const deleted = [];
  let detached = false;
  const scope = {
    listCandidateFiles: async () => [{ path: 'Benchmark-test/a.md' }, { path: 'private.md' }],
    isCandidateFile: async () => true,
    isPathVisible: () => true,
  };
  const view = {
    messages: [],
    inputArea: { value: '' },
    modelSelectEl: { value: 'selected' },
    nativeVaultTool: { port: { fileScope: scope } },
    session: { filePath: null },
    async handleSend() {
      assert.equal(this.modelSelectEl.value, 'selected');
      assert.deepEqual(await this.nativeVaultTool.port.fileScope.listCandidateFiles(), [
        { path: 'Benchmark-test/a.md' },
      ]);
      assert.equal(
        await this.nativeVaultTool.port.fileScope.isCandidateFile({ path: 'private.md' }),
        false,
      );
      this.messages.push({
        role: 'assistant',
        content: '답변',
        status: 'complete',
        stopReason: 'complete',
        citations: [],
      });
      this.session.filePath = 'new-session.md';
    },
    async onClose() {},
  };
  const app = {
    workspace: {
      getLeaf: () => ({
        view,
        async setViewState() {},
        detach() {
          detached = true;
        },
      }),
      activeLeaf: null,
    },
    vault: {
      getAbstractFileByPath: (p) => ({ path: p }),
      delete: async (f) => deleted.push(f.path),
    },
  };
  const result = await nativeProductAnswer(app, { scope: 'Benchmark-test', question: '합성 질문' });
  assert.equal(result.answer, '답변');
  assert.equal(detached, true);
  assert.deepEqual(deleted, ['new-session.md']);
  assert.equal(scope.isPathVisible('private.md'), true);
});

test('신뢰구간은 반복 실행을 질문 단위로 묶으며 부분 실행에는 붙이지 않는다', () => {
  const rows = [
    { id: 'a', grade: { correct: true } },
    { id: 'b', grade: { correct: false } },
  ];
  assert.deepEqual(
    questionInterval(rows, (r) => r.grade.correct),
    questionInterval(
      rows.flatMap((r) => [r, r, r]),
      (r) => r.grade.correct,
    ),
  );
  assert.equal(summarizeNative(rows, 4).correctInterval, null);
});

test('제품 오류도 분모에 포함하고 판정 실패를 정답으로 집계하지 않는다', () => {
  const summary = summarizeNative(
    [
      { grade: { correct: true, complete: true, supported: true }, elapsedMs: 10 },
      { error: 'timeout', elapsedMs: 100 },
      { grade: null, elapsedMs: 20 },
    ],
    3,
  );
  assert.equal(summary.correctRate, 1 / 3);
  assert.equal(summary.groundedRate, 1 / 3);
  assert.equal(summary.errors, 1);
  assert.equal(summary.unjudged, 2);
  assert.equal(summary.p95Ms, 100);
});

test('부분 실행과 다른 채점 방식은 경쟁 우위 문구로 바뀌지 않는다', () => {
  const markdown = renderComparison(
    {
      dataset: 'wix',
      documents: 3,
      selectedQuestions: 1,
      availableQuestions: 200,
      repeats: 1,
      model: 'selected',
      summary: summarizeNative([{ grade: { correct: true } }], 200),
      publicClaims: { ready: false },
    },
    publicReferences,
  );
  assert.match(markdown, /92\.5%/);
  assert.match(markdown, /직접 비교 불가/);
  assert.doesNotMatch(markdown, /더 뛰어|월등|승리|1위/);
  assert.match(markdown, /부분 실행/);
});

test('실행 중 예외에도 새 화면을 닫고 생성한 세션만 정리한다', async () => {
  let closed = false;
  const view = {
    inputArea: { value: '' },
    messages: [],
    nativeVaultTool: { port: { fileScope: {} } },
    session: { filePath: 'owned.md' },
    async handleSend() {
      throw new Error('실패');
    },
    async onClose() {
      closed = true;
    },
  };
  const removed = [];
  const app = {
    workspace: { getLeaf: () => ({ view, async setViewState() {}, detach() {} }) },
    vault: {
      getAbstractFileByPath: (p) => ({ path: p }),
      delete: async (f) => removed.push(f.path),
    },
  };
  await assert.rejects(nativeProductAnswer(app, { scope: 'Benchmark-test', question: '합성' }));
  assert.equal(closed, true);
  assert.deepEqual(removed, ['owned.md']);
});

test('취소 신호를 무시하는 준비 작업도 제한 시간 후 평가 화면을 정리한다', async () => {
  let closed = false;
  const controller = new AbortController();
  const view = {
    inputArea: { value: '' },
    messages: [],
    abortController: controller,
    nativeVaultTool: { port: { fileScope: {} } },
    session: { filePath: null },
    handleSend: () => new Promise(() => {}),
    async onClose() {
      closed = true;
    },
  };
  const app = {
    workspace: { getLeaf: () => ({ view, async setViewState() {}, detach() {} }) },
    vault: {},
  };
  await assert.rejects(
    nativeProductAnswer(app, { scope: 'Benchmark-test', question: '합성', timeoutMs: 5 }),
    /시간 초과/,
  );
  assert.equal(controller.signal.aborted, true);
  assert.equal(closed, true);
});

test('공개 코퍼스를 준비할 때 빈 제목이나 평가용 헤딩을 본문에 추가하지 않는다', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-corpus-'));
  try {
    await mkdir(path.join(root, 'datasets/wix/raw/wix_kb_corpus'), { recursive: true });
    const text = '## 합성 문서\n\n요금은 700원입니다.\n';
    await writeFile(
      path.join(root, 'datasets/wix/raw/wix_kb_corpus/wix_kb_corpus.jsonl'),
      JSON.stringify({ id: 'synthetic', contents: text }) + '\n',
    );
    await prepareWix(root);
    assert.equal(
      await readFile(
        path.join(root, 'datasets/wix/documents', safeDocumentPath('synthetic', 'wix')),
        'utf8',
      ),
      text,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('같은 정답 ID의 원문을 모두 보존하고 공식 질문 ID를 유지한다', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-mapping-'));
  try {
    const directory = path.join(root, 'datasets/enterprise');
    await mkdir(path.join(directory, 'documents'), { recursive: true });
    await mkdir(path.join(directory, 'raw'), { recursive: true });
    const records = [
      { id: 'same-id', path: 'a.md' },
      { id: 'same-id', path: 'b.md' },
    ];
    for (const record of records)
      await writeFile(path.join(directory, 'documents', record.path), '독립적으로 만든 합성 원문');
    await writeFile(
      path.join(directory, 'documents.jsonl'),
      records.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    await writeFile(
      path.join(directory, 'raw/questions.jsonl'),
      JSON.stringify({
        question_id: 'synthetic-question',
        question: '합성 질문',
        gold_answer: '합성 정답',
        expected_doc_ids: ['same-id'],
      }) + '\n',
    );
    const data = await loadNativeCorpus('enterprise', undefined, root);
    assert.equal(data.questions.length, 1);
    assert.equal(data.questions[0].officialId, 'synthetic-question');
    assert.deepEqual(data.questions[0].expectedPaths, ['a.md', 'b.md']);
    assert.equal(data.records.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('화면 닫기 오류에도 생성한 세션과 화면을 정리한다', async () => {
  const deleted = [];
  let detached = false;
  const view = {
    inputArea: { value: '' },
    messages: [],
    nativeVaultTool: { port: { fileScope: {} } },
    session: { filePath: 'owned.md' },
    async handleSend() {
      throw new Error('응답 실패');
    },
    async onClose() {
      throw new Error('닫기 실패');
    },
  };
  const app = {
    workspace: {
      getLeaf: () => ({
        view,
        async setViewState() {},
        detach() {
          detached = true;
        },
      }),
    },
    vault: {
      getAbstractFileByPath: (p) => ({ path: p }),
      delete: async (f) => deleted.push(f.path),
    },
  };
  await assert.rejects(
    nativeProductAnswer(app, { scope: 'Benchmark-test', question: '합성 질문' }),
    /닫기 실패/,
  );
  assert.deepEqual(deleted, ['owned.md']);
  assert.equal(detached, true);
});

test('화면의 추가 질문 카드를 빈 답변으로 오인하거나 최종 정답으로 집계하지 않는다', async () => {
  const view = {
    inputArea: { value: '' },
    messages: [],
    nativeVaultTool: { port: { fileScope: {} } },
    session: { filePath: null },
    async handleSend() {
      this.messages.push({
        role: 'assistant',
        content: '',
        status: 'complete',
        stopReason: 'complete',
        assistantQuestion: { prompt: '어떤 기간을 말씀하시나요?', choices: [{ label: '올해' }] },
      });
    },
    async onClose() {},
  };
  const app = {
    workspace: { getLeaf: () => ({ view, async setViewState() {}, detach() {} }) },
    vault: {},
  };
  const result = await nativeProductAnswer(app, { scope: 'Benchmark-test', question: '합성 질문' });
  assert.equal(result.terminal, 'clarification');
  assert.equal(result.error, null);
  assert.match(result.answer, /어떤 기간/);
  assert.equal(summarizeNative([{ ...result, grade: { correct: true } }]).correctRate, 0);
});

test('네이티브 화면에 표시된 출처 카드는 검증한 줄 범위만 평가 근거로 쓴다', () => {
  const citations = [
    { filePath: 'synthetic/a.md', status: 'verified', line: 2, endLine: 4 },
    { filePath: 'synthetic/a.md', status: 'verified', line: 2, endLine: 4 },
    { filePath: 'synthetic/b.md', status: 'candidate', line: 1, endLine: 2 },
    { filePath: 'synthetic/c.md', status: 'verified', line: 0, endLine: 2 },
  ];
  const selected = selectNativeCitationRanges(citations);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, 'vault:synthetic/a.md:2-4');
  assert.equal(selected[0].line, 2);
  assert.equal(selected[0].endLine, 4);
  const result = validateGrade(
    JSON.stringify({ correct: true, complete: true, supported: true, abstained: false }),
    { answer: '합성 답변 [출처](synthetic/a.md)' },
    citations,
    selected,
  );
  assert.equal(result.grade.supported, true);
});
