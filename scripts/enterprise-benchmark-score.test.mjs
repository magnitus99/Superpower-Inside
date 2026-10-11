import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  extractOfficialPrompt,
  scoreEnterpriseAnswer,
  aggregateEnterprise,
} from './enterprise-benchmark-score.mjs';

test('공식 원문의 템플릿을 추출하고 중괄호와 줄 연결을 보존한다', () => {
  const source = 'EXAMPLE = """{query}\\\n{{"aligned":"yes"}}""".strip()';
  assert.equal(
    extractOfficialPrompt(source, 'EXAMPLE', { query: '합성 질문' }),
    '합성 질문{"aligned":"yes"}',
  );
  assert.throws(() => extractOfficialPrompt(source, 'MISSING', {}));
});

test('공식 종합 점수는 정확한 답변의 사실 충족 비율이며 단순 정확도와 다르다', async () => {
  const prompts = { stripping: 'strip', correctness: 'correct', fact: 'fact {statement}' };
  const outputs = ['정규화한 합성 답변', '{"aligned":"yes","reason":"합성"}', 'yes', 'no'];
  const result = await scoreEnterpriseAnswer(
    {
      question: '합성',
      reference: '합성',
      facts: ['첫 사실', '둘째 사실'],
      expectedDocumentIds: ['a', 'b'],
    },
    { answer: '합성 답변', documentIds: ['a', 'c'] },
    prompts,
    async () => outputs.shift(),
  );
  assert.equal(result.answer_correct, true);
  assert.equal(result.completeness_pct, 50);
  assert.equal(result.document_recall_pct, 50);
  assert.equal(result.invalid_extra_docs, 1);
  const summary = aggregateEnterprise(
    [result, { answer_correct: false, completeness_pct: 100 }],
    2,
  );
  assert.equal(summary.overallScore, 25);
  assert.equal(summary.correctness, 50);
});

test('잘못된 판정 형식은 성공이 되지 않으며 원문을 오류에 포함하지 않는다', async () => {
  const prompts = { stripping: 'strip', correctness: 'correct', fact: 'fact' };
  const outputs = ['합성', '{"aligned":"maybe"}'];
  await assert.rejects(
    scoreEnterpriseAnswer({ reference: '기준', facts: [] }, { answer: '답변' }, prompts, async () =>
      outputs.shift(),
    ),
    /판정 스키마/,
  );
});
