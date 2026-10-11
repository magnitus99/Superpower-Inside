import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function extractOfficialPrompt(source, name, values) {
  if (!/^[A-Z_]+$/.test(name)) throw new Error('템플릿 이름 오류');
  const raw = new RegExp(`${name} = """([\\s\\S]*?)"""\\.strip\\(\\)`).exec(source)?.[1];
  if (!raw) throw new Error('공식 판정 템플릿 누락');
  return raw
    .replace(/\\\r?\n/g, '')
    .trim()
    .replace(/\{\{|\}\}|\{([a-z_]+)\}/g, (match, key) => {
      if (match === '{{') return '{';
      if (match === '}}') return '}';
      if (!(key in values)) throw new Error('템플릿 입력 누락');
      return values[key];
    });
}

// 공식 MIT 평가 코드의 원문·리비전·체크섬을 로컬에 고정하고 재개 시 재사용합니다.
export async function loadOfficialProtocol(directory) {
  execFileSync('git', ['check-ignore', directory], { stdio: 'ignore' });
  await mkdir(directory, { recursive: true });
  const manifestFile = path.join(directory, 'manifest.json');
  let manifest = await readFile(manifestFile, 'utf8').then(JSON.parse, () => null);
  if (!manifest) {
    const response = await fetch(
      'https://api.github.com/repos/onyx-dot-app/EnterpriseRAG-Bench/commits/main',
    );
    if (!response.ok) throw new Error('공식 평가 리비전 조회 실패');
    const revision = (await response.json()).sha;
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('공식 평가 리비전 오류');
    const files = [
      'LICENSE',
      'src/prompts/answer_evaluation.py',
      'src/utils/eval_utils.py',
      'src/scripts/answer_evaluation/metrics_based_eval.py',
    ];
    manifest = { revision, correction: 'no-correction', files: [] };
    for (const filename of files) {
      const url = `https://raw.githubusercontent.com/onyx-dot-app/EnterpriseRAG-Bench/${revision}/${filename}`;
      const source = await fetch(url);
      if (!source.ok) throw new Error('공식 평가 자료 다운로드 실패');
      const bytes = Buffer.from(await source.arrayBuffer());
      if (filename === 'LICENSE' && !bytes.toString().includes('MIT License'))
        throw new Error('공식 평가 라이선스 오류');
      const local = path.join(directory, path.basename(filename));
      await writeFile(local, bytes);
      manifest.files.push({
        filename,
        url,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  }
  for (const file of manifest.files) {
    const bytes = await readFile(path.join(directory, path.basename(file.filename)));
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
      throw new Error('공식 평가 자료 체크섬 불일치');
  }
  const source = await readFile(path.join(directory, 'answer_evaluation.py'), 'utf8');
  return {
    manifest,
    stripping: extractOfficialPrompt(source, 'ANSWER_CITATION_STRIPPING_PROMPT', {
      answer_string: '{answer_string}',
    }),
    correctness: extractOfficialPrompt(source, 'ANSWER_WHOLISTIC_EVALUATION_PROMPT', {
      query: '{query}',
      gold_answer: '{gold_answer}',
      candidate_answer: '{candidate_answer}',
    }),
    fact: extractOfficialPrompt(source, 'INDIVIDUAL_FACT_VALIDATOR_PROMPT', {
      answer: '{answer}',
      statement: '{statement}',
    }),
  };
}

const fill = (template, values) =>
  template.replace(/\{([a-z_]+)\}/g, (match, key) => (key in values ? values[key] : match));
const json = (raw) =>
  JSON.parse(
    raw
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, ''),
  );

export async function scoreEnterpriseAnswer(question, result, prompts, generate) {
  const expected = new Set(question.expectedDocumentIds ?? []);
  const actual = new Set(result.documentIds ?? []);
  const score = {
    question_id: question.officialId,
    question_type: question.category,
    corrected: false,
    answer_correct: false,
    completeness_pct: 0,
    document_recall_pct: expected.size
      ? ([...expected].filter((id) => actual.has(id)).length / expected.size) * 100
      : null,
    invalid_extra_docs: expected.size ? [...actual].filter((id) => !expected.has(id)).length : null,
  };
  if (!result.answer || result.error || (result.terminal && result.terminal !== 'answer'))
    return score;
  const answer = await generate(fill(prompts.stripping, { answer_string: result.answer }));
  if (!answer.trim()) throw new Error('공식 인용 정리 실패');
  if (question.reference) {
    const grade = json(
      await generate(
        fill(prompts.correctness, {
          query: question.question,
          gold_answer: question.reference,
          candidate_answer: answer,
        }),
      ),
    );
    if (!['yes', 'no'].includes(grade.aligned)) throw new Error('공식 판정 스키마 오류');
    score.answer_correct = grade.aligned === 'yes';
  } else score.answer_correct = true;
  const facts = question.facts ?? [];
  let covered = 0;
  for (const fact of facts) {
    const response = await generate(fill(prompts.fact, { answer, statement: fact }));
    const first = response.trim().split('\n')[0];
    if (!/\b(?:yes|no)\b/i.test(first)) throw new Error('공식 사실 판정 스키마 오류');
    if (/\byes\b/i.test(first)) covered++;
  }
  score.completeness_pct = facts.length ? Math.round((covered / facts.length) * 10000) / 100 : 100;
  score.document_recall_pct =
    score.document_recall_pct === null ? null : Math.round(score.document_recall_pct * 100) / 100;
  return score;
}

export function aggregateEnterprise(scores, planned = scores.length) {
  const mean = (key) => {
    const applicable = scores.filter((s) => Number.isFinite(s[key]));
    return applicable.length
      ? applicable.reduce((sum, s) => sum + s[key], 0) / applicable.length
      : null;
  };
  return {
    executed: scores.length,
    planned,
    overallScore: planned
      ? scores.reduce((sum, s) => sum + (s.answer_correct ? s.completeness_pct : 0), 0) / planned
      : null,
    correctness: planned ? (scores.filter((s) => s.answer_correct).length / planned) * 100 : null,
    completeness: planned ? scores.reduce((sum, s) => sum + s.completeness_pct, 0) / planned : null,
    recall: mean('document_recall_pct'),
    invalidExtraDocs: mean('invalid_extra_docs'),
  };
}
