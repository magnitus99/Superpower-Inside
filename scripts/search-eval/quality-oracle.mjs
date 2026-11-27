// 평가 전용: 제품 tokenizer·planner·검색 결과를 사용하지 않는 고정 scanner입니다.
export function lexicalOracle(documents, terms, excluded = []) {
  const normalize = (text) => text.normalize('NFKC').toLowerCase();
  const needles = terms.map(normalize);
  const uniqueNeedles = [...new Set(needles.filter(Boolean))];
  const blocked = new Set(excluded);
  const rows = [];
  if (uniqueNeedles.length) for (const document of documents) {
    if (blocked.has(document.path)) continue;
    const matches = new Map(uniqueNeedles.map((needle) => [needle, { passages: [], occurrences: 0 }]));
    for (const [index, raw] of document.text.split('\n').entries()) {
      const line = normalize(raw);
      for (const [needle, match] of matches) {
        let offset = 0, count = 0;
        while ((offset = line.indexOf(needle, offset)) !== -1) { count++; offset += needle.length; }
        if (count) match.passages.push(index + 1);
        match.occurrences += count;
      }
    }
    for (const [index, needle] of needles.entries()) {
      const match = matches.get(needle);
      if (match?.occurrences) rows.push({ path: document.path, term: terms[index], passages: [...match.passages], occurrences: match.occurrences });
    }
  }
  return { rows, documents: new Set(rows.map((row) => row.path)).size,
    passages: rows.reduce((n, row) => n + row.passages.length, 0),
    occurrences: rows.reduce((n, row) => n + row.occurrences, 0) };
}

// referenceOracle는 같은 documents/terms/exclusion으로 만든 독립 기준선입니다.
export async function auditLiteralInventory(testCase, inventory, readPage, documents, collectedPaths = [], scan = lexicalOracle, referenceOracle) {
  const normalize = (text) => text.normalize('NFKC').toLowerCase();
  const excluded = testCase.hardExcludedPaths ?? [];
  const blocked = new Set(excluded);
  const oracle = referenceOracle ?? scan(documents, testCase.terms, excluded);
  const missing = new Set(oracle.rows.map((row) => row.path));
  for (const path of collectedPaths) missing.delete(path);
  if (inventory?.status !== 'complete' || typeof readPage !== 'function') return { passed: false, discoveryMissing: missing.size };
  const summary = inventory.summary;
  if (summary?.matchMode !== 'nfkc-unicode-lower-line-substring-v1' || !Number.isSafeInteger(summary.pageCount) || summary.pageCount < 0 || !Array.isArray(summary.needles)) return { passed: false, discoveryMissing: missing.size };
  const selected = new Map(), required = new Map();
  const expectedByNeedle = new Map(), expectedByTerm = new Map();
  const encoder = new TextEncoder();
  const allowedDocuments = documents.filter((document) => !blocked.has(document.path));
  const sources = new Map(allowedDocuments.map((document) => [document.path, document]));
  let valid = summary.sources === sources.size && sources.size === allowedDocuments.length && !collectedPaths.some((path) => blocked.has(path));
  const addNeedle = (needle, term) => {
    const expected = { documents: 0, matchingLines: 0, occurrences: 0, lastPath: null };
    expectedByNeedle.set(needle, expected);
    expectedByTerm.set(term, expected);
  };
  for (const term of testCase.terms) {
    const needle = normalize(term);
    if (!expectedByNeedle.has(needle)) addNeedle(needle, term);
    required.set(needle, (required.get(needle) ?? 0) + 1);
  }
  const plannerTerms = [];
  for (const [index, actual] of summary.needles.entries()) {
    if (!actual || typeof actual.needle !== 'string' || !actual.needle || actual.normalizedNeedle !== normalize(actual.needle)) { valid = false; continue; }
    const needle = actual.normalizedNeedle;
    const remaining = required.get(needle);
    if (remaining === 1) required.delete(needle);
    else if (remaining > 1) required.set(needle, remaining - 1);
    if (!expectedByNeedle.has(needle)) { addNeedle(needle, actual.needle); plannerTerms.push(actual.needle); }
    selected.set(index, { needle, bytes: encoder.encode(needle).length, expected: expectedByNeedle.get(needle), documents: 0, matchingLines: 0, occurrences: 0, lastPath: null });
  }
  const countRows = (rows) => {
    for (const row of rows) {
      const expected = expectedByTerm.get(row.term);
      // 스캐너의 문서 순서를 이용해 동일 term 입력에서 나온 같은 문서 행을 한 번만 셉니다.
      if (!expected || expected.lastPath === row.path) continue;
      expected.lastPath = row.path;
      expected.documents++;
      expected.matchingLines += row.passages.length;
      expected.occurrences += row.occurrences;
    }
  };
  countRows(oracle.rows);
  if (plannerTerms.length) countRows(scan(documents, plannerTerms, excluded).rows);
  for (const [index, { expected }] of selected) {
    const actual = summary.needles[index];
    if (actual.documents !== expected.documents || actual.matchingLines !== expected.matchingLines || actual.occurrences !== expected.occurrences) valid = false;
  }
  let group, linePath;
  let lines = [];
  const finish = () => { if (group && group.text.indexOf(group.state.needle, group.cursor) !== -1) valid = false; };
  try {
    for (let pageIndex = 0; pageIndex < summary.pageCount; pageIndex++) {
      const page = await readPage(pageIndex);
      if (!page || page.pageIndex !== pageIndex || page.nextPage !== (pageIndex + 1 < summary.pageCount ? pageIndex + 1 : null) || !Array.isArray(page.references) || page.references.length === 0) { valid = false; break; }
      for (const reference of page.references) {
        if (!reference || !sources.has(reference.path)) { valid = false; continue; }
        const state = selected.get(reference.needleIndex);
        if (!state) { valid = false; continue; }
        if (linePath !== reference.path) { linePath = reference.path; lines = sources.get(reference.path).text.split('\n'); }
        if (!Number.isSafeInteger(reference.line) || reference.line < 1 || reference.line > lines.length) { valid = false; continue; }
        if (!group || group.path !== reference.path || group.line !== reference.line || group.index !== reference.needleIndex) {
          finish();
          if (group && (reference.path < group.path || (reference.path === group.path && (reference.line < group.line || (reference.line === group.line && reference.needleIndex <= group.index))))) valid = false;
          const text = group?.path === reference.path && group.line === reference.line ? group.text : normalize(lines[reference.line - 1]);
          group = { path: reference.path, line: reference.line, index: reference.needleIndex, state, text, cursor: 0, byteCursor: 0 };
          if (state.lastPath !== reference.path) { state.documents++; state.lastPath = reference.path; }
          state.matchingLines++;
        }
        const start = group.text.indexOf(state.needle, group.cursor);
        if (start < 0) { valid = false; continue; }
        const byteStart = group.byteCursor + encoder.encode(group.text.slice(group.cursor, start)).length;
        const byteEnd = byteStart + state.bytes;
        if (reference.normalizedStart !== byteStart || reference.normalizedEnd !== byteEnd) valid = false;
        else missing.delete(reference.path);
        group.cursor = start + state.needle.length; group.byteCursor = byteEnd;
        state.occurrences++;
      }
    }
    finish();
    if (await readPage(summary.pageCount) !== null) valid = false;
  } catch { valid = false; }
  for (const state of selected.values()) if (state.documents !== state.expected.documents || state.matchingLines !== state.expected.matchingLines || state.occurrences !== state.expected.occurrences) valid = false;
  return { passed: valid && required.size === 0 && selected.size === summary.needles.length, discoveryMissing: missing.size };
}

export function scoreInformation(testCase, evidence, documents) {
  const gold = testCase.information ?? [];
  const required = new Set(gold.map((info) => info.id));
  if (required.size !== gold.length) throw new Error('quality-duplicate-gold-id');
  const found = new Set();
  const usefulSeen = new Set();
  let usefulCopies = 0, noise = 0, citationFailures = 0;
  let deliveredBytes = 0;
  for (const item of evidence) {
    const document = documents.find((document) => document.path === item.path);
    const before = item.contextBefore === undefined ? '' : item.contextBefore;
    const after = item.contextAfter === undefined ? '' : item.contextAfter;
    const lines = document?.text.split('\n') ?? [];
    let payloadStart = -1, payload = '';
    if (document && typeof item.quote === 'string' && item.quote.length > 0 &&
        typeof before === 'string' && typeof after === 'string' &&
        Number.isSafeInteger(item.startLine) && Number.isSafeInteger(item.endLine) &&
        item.startLine >= 1 && item.endLine >= item.startLine && item.endLine <= lines.length) {
      const lineStart = lines.slice(0, item.startLine - 1).reduce((sum, line) => sum + line.length + 1, 0);
      const segment = lines.slice(item.startLine - 1, item.endLine).join('\n') + (item.endLine < lines.length ? '\n' : '');
      for (let offset = segment.indexOf(item.quote); offset !== -1; offset = segment.indexOf(item.quote, offset + 1)) {
        const start = lineStart + offset;
        const end = start + item.quote.length;
        if (document.text.slice(0, start).split('\n').length !== item.startLine ||
            document.text.slice(0, end - 1).split('\n').length !== item.endLine || start < before.length) continue;
        const delivered = before + item.quote + after;
        const from = start - before.length;
        if (document.text.slice(from, from + delivered.length) !== delivered) continue;
        payloadStart = from;
        payload = delivered;
        break;
      }
    }
    const valid = payloadStart >= 0;
    if (!valid) citationFailures++;
    deliveredBytes += new TextEncoder().encode([item.quote, before, after].filter((value) => typeof value === 'string' && value.length > 0).join('\n')).length;
    const matches = gold.filter((info) => {
      if (!valid || info.path !== item.path || !Number.isSafeInteger(info.line) ||
          info.line < 1 || info.line > lines.length || typeof info.text !== 'string' || !info.text.length) return false;
      const lineStart = lines.slice(0, info.line - 1).reduce((sum, line) => sum + line.length + 1, 0);
      const position = document.text.indexOf(info.text, Math.max(lineStart, payloadStart));
      return position >= lineStart && position <= lineStart + lines[info.line - 1].length &&
        position >= payloadStart && position + info.text.length <= payloadStart + payload.length;
    });
    // 다른 문서에 복제된 같은 정보도 recall 가산 없이 중복 비용으로 셉니다.
    const useful = new Set(gold.filter((info) => valid && payload.includes(info.text)).map((info) => info.id));
    if (!useful.size) noise++;
    usefulCopies += useful.size;
    for (const id of useful) usefulSeen.add(id);
    for (const info of matches) found.add(info.id);
  }
  const missing = [...required].filter((id) => !found.has(id)).length;
  const hardLeakage = evidence.filter((item) => (testCase.hardExcludedPaths ?? []).includes(item.path)).length;
  return { required: required.size, found: found.size, missing,
    uniqueUsefulRecall: required.size ? found.size / required.size : null,
    duplication: usefulCopies - usefulSeen.size, noise, deliveredBytes,
    density: deliveredBytes ? found.size / deliveredBytes : 0,
    citationFailures, hardLeakage, noAnswerPass: testCase.expectNoAnswer ? evidence.length === 0 : null,
    passed: missing === 0 && citationFailures === 0 && hardLeakage === 0 && (!testCase.expectNoAnswer || evidence.length === 0) };
}

export function mandatoryGate(rows) { return rows.length > 0 && rows.every((row) => row.passed === true); }

// 관측되지 않은 중간 단계를 추측하지 않습니다.
export function firstLoss({ oracleFound, discoveryFound, verifiedFound, dossierFound }) {
  if (oracleFound !== true) return 'unknown';
  for (const [stage, found] of [['discovery', discoveryFound], ['verification', verifiedFound], ['dossier', dossierFound]]) {
    if (found !== true) return found === false ? stage : 'unknown';
  }
  return 'none';
}
