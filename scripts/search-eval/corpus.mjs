// 합성 검색 평가 코퍼스 생성기.
// 실볼트와 무관한 고정 시드 가상 문서·질의·3단 골드(문서/구절/상충쌍)만 만들고,
// dev/held-out은 네임스페이스·시드·엔티티를 분리해 서로 겹치지 않게 한다.

export const SEARCH_EVAL_CATEGORIES = Object.freeze([
  'en-mixed',
  'ko-mixed',
  'similar-names',
  'numbers',
  'negation',
  'conditions',
  'dates',
  'duplicates',
  'multi-hop',
  'phrase',
  'field-title',
  'field-path',
  'conflict-pair',
  'no-answer',
]);

export const SEARCH_EVAL_SCALES = Object.freeze({
  ci: 240,
  '1k': 1000,
  '10k': 10000,
  '50k': 50000,
  '100k': 100000,
});

const EN_NAMES = Object.freeze([
  'orlan',
  'vesper',
  'cendral',
  'mirado',
  'tavren',
  'quilla',
  'brennar',
  'stivor',
  'aldane',
  'pyrra',
  'kelvor',
  'runeth',
]);

const KO_NAMES = Object.freeze([
  '해오름',
  '별솔',
  '가온누리',
  '다솜',
  '미르',
  '윤슬',
  '초롱',
  '한결',
  '노을',
  '바람결',
  '여울',
  '온새미로',
]);

// 정답 없는 질의 전용 토큰. 다른 합성 문서에는 절대 넣지 않는다.
const NO_ANSWER_WORDS = Object.freeze(['zynthar', 'quorum']);

export function createSyntheticCorpus(options = {}) {
  const scale = options.scale ?? 'ci';
  const documentTarget = SEARCH_EVAL_SCALES[scale];
  if (!documentTarget) throw new Error(`알 수 없는 scale: ${scale}`);
  const split = options.split === 'heldout' ? 'heldout' : 'dev';
  const seed = Number.isInteger(options.seed) ? options.seed : 20261019;
  const queriesPerCategory = options.queriesPerCategory ?? (scale === 'ci' ? 3 : 6);
  if (!Number.isInteger(queriesPerCategory) || queriesPerCategory < 2 || queriesPerCategory > 20)
    throw new Error('queriesPerCategory는 2..20 정수여야 합니다.');
  const ns = split === 'dev' ? 'dv' : 'ho';
  const random = mulberry32(seed * 31 + (split === 'heldout' ? 977 : 0));

  const specs = [];
  const queries = [];
  for (const category of SEARCH_EVAL_CATEGORIES) {
    for (let index = 0; index < queriesPerCategory; index += 1) {
      const built = buildCase(category, index, ns, random);
      specs.push(...built.documents);
      queries.push(built.query);
    }
  }
  const caseDocumentCount = specs.length;
  if (caseDocumentCount >= documentTarget)
    throw new Error(`scale ${scale}의 문서 수가 케이스 문서 수보다 작습니다.`);
  for (let index = caseDocumentCount; index < documentTarget; index += 1)
    specs.push(buildFiller(index, ns, random));

  const documents = specs.map(assembleDocument);
  const byPath = new Map(documents.map((document) => [document.path, document]));
  for (const query of queries) {
    query.goldPaths = [...new Set(query.goldChunks.map((ref) => ref.path))];
    query.goldPassages = query.goldChunks.map((ref) => {
      const document = byPath.get(ref.path);
      const chunk = document.chunks[ref.chunkIndex];
      return { path: ref.path, startLine: chunk.startLine, endLine: chunk.endLine };
    });
    query.forbiddenPaths = [...new Set(query.forbiddenChunks.map((ref) => ref.path))];
    delete query.goldChunks;
    delete query.forbiddenChunks;
  }

  const categoryCounts = {};
  for (const query of queries)
    categoryCounts[query.category] = (categoryCounts[query.category] ?? 0) + 1;
  return {
    scale,
    split,
    seed,
    queriesPerCategory,
    documents,
    queries,
    stats: {
      documentCount: documents.length,
      chunkCount: documents.reduce((total, document) => total + document.chunks.length, 0),
      bodyBytes: documents.reduce((total, document) => total + Buffer.byteLength(document.text, 'utf8'), 0),
      queryCount: queries.length,
      categoryCounts,
      caseDocumentCount,
    },
  };
}

function buildCase(category, index, ns, random) {
  const shift = Math.floor(random() * EN_NAMES.length);
  const enA = EN_NAMES[(index + shift) % EN_NAMES.length];
  const enB = EN_NAMES[(index + 5 + shift) % EN_NAMES.length];
  const koB = KO_NAMES[(index + 7 + shift) % KO_NAMES.length];
  const id = `${ns}${index}`;
  const token = `${enA}-${category}-${id}`;
  const bridge = `${enB}-bridge-${id}`;
  const family = (name) => `${ns}-${name}${index}`;
  const englishQuery = (text) => ({ text, language: 'en' });
  const koreanQuery = (text) => ({ text, language: 'ko' });

  switch (category) {
    case 'en-mixed': {
      const path = `${family('mixed')}/${enA}-${id}.md`;
      return caseResult(
        [
          spec(path, `${enA} ${id} 운영 노트`, [
            `# ${enA} ${id} 운영 노트`,
            `${enA} keeps the ${enB} ledger in the regional archive.`,
            `${token} keeps the quarterly review cadence for the ${enB} ledger.`,
            `Escalations go to the archive owner.`,
          ], [2]),
        ],
        query(`en-mixed-${index}`, ns, 'en-mixed', englishQuery(`Where is the review cadence for ${token} recorded?`), [
          { path, chunkIndex: 2 },
        ]),
      );
    }
    case 'ko-mixed': {
      const path = `${family('mixed')}/${enA}-${id}-ko.md`;
      return caseResult(
        [
          spec(path, `${enA} ${id} 점검 노트`, [
            `# ${enA} ${id} 점검 노트`,
            `${token} 정기 점검 주기는 분기마다이며 담당은 ${koB}이다.`,
            `점검 결과는 지역 아카이브에 남긴다.`,
          ], [1]),
        ],
        query(`ko-mixed-${index}`, ns, 'ko-mixed', koreanQuery(`${token} 정기 점검 주기 알려줘`), [
          { path, chunkIndex: 1 },
        ]),
      );
    }
    case 'similar-names': {
      const path = `${family('similar')}/${enA}-${id}.md`;
      const alt1 = `${family('similar')}/${enA}-${id}-alt1.md`;
      const alt2 = `${family('similar')}/${enA}-${id}-alt2.md`;
      return caseResult(
        [
          spec(path, `${enA} ${id} 페이로드 노트`, [
            `# ${enA} ${id} 페이로드 노트`,
            `${token} 페이로드 마감은 매주 목요일이다.`,
            `마감 이후 변경은 다음 주기로 넘긴다.`,
          ], [1]),
          spec(alt1, `${enA} ${id}-alt1 기록`, [`# ${enA} ${id}-alt1 기록`, `${enA}-${id}-alt1 은 배포 창구를 주 단위로 확인한다.`]),
          spec(alt2, `${enA} ${id}-alt2 기록`, [`# ${enA} ${id}-alt2 기록`, `${enA}-${id}-alt2 은 보존 창구를 달 단위로 확인한다.`]),
        ],
        query(`similar-names-${index}`, ns, 'similar-names', koreanQuery(`${token} 페이로드 마감`), [
          { path, chunkIndex: 1 },
        ]),
      );
    }
    case 'numbers': {
      const path = `${family('numbers')}/${enA}-${id}.md`;
      const distractor = `${family('numbers')}/${enA}-${id}-limit.md`;
      return caseResult(
        [
          spec(path, `${enA} ${id} 한도 노트`, [
            `# ${enA} ${id} 한도 노트`,
            `${token} 배치 한도는 37개다.`,
            `한도 초과분은 다음 배치로 넘긴다.`,
          ], [1]),
          spec(distractor, `${enA} ${id} 이전 한도`, [`# ${enA} ${id} 이전 한도`, `${token} 배치 한도는 38개다.`]),
        ],
        query(`numbers-${index}`, ns, 'numbers', koreanQuery(`${token} 배치 한도 37개`), [
          { path, chunkIndex: 1 },
        ]),
      );
    }
    case 'negation': {
      const path = `${family('negation')}/${enA}-${id}.md`;
      const distractor = `${family('negation')}/${enA}-${id}-approved.md`;
      return caseResult(
        [
          spec(path, `${enA} ${id} 승인 기록`, [
            `# ${enA} ${id} 승인 기록`,
            `${token}은 마이그레이션을 승인하지 않았다.`,
            `미승인 사유는 보안 검토 대기다.`,
          ], [1]),
          spec(distractor, `${enA} ${id} 승인 완료 기록`, [`# ${enA} ${id} 승인 완료 기록`, `${token}은 마이그레이션을 승인했다.`], [], [1]),
        ],
        query(`negation-${index}`, ns, 'negation', koreanQuery(`${token} 마이그레이션 승인하지 않다`), [
          { path, chunkIndex: 1 },
        ]),
      );
    }
    case 'conditions': {
      const path = `${family('conditions')}/${enA}-${id}.md`;
      const distractor = `${family('conditions')}/${enA}-${id}-always.md`;
      return caseResult(
        [
          spec(path, `${enA} ${id} 재색인 조건`, [
            `# ${enA} ${id} 재색인 조건`,
            `${token}은 캐시가 차가울 때에만 재색인을 실행한다.`,
            `조건이 아니면 기존 색인을 재사용한다.`,
          ], [1]),
          spec(distractor, `${enA} ${id} 재색인 기본`, [`# ${enA} ${id} 재색인 기본`, `${token}은 재색인을 항상 실행한다.`], [], [1]),
        ],
        query(`conditions-${index}`, ns, 'conditions', koreanQuery(`${token} 재색인 캐시 차가울 때`), [
          { path, chunkIndex: 1 },
        ]),
      );
    }
    case 'dates': {
      const path = `${family('dates')}/${enA}-${id}.md`;
      const distractor = `${family('dates')}/${enA}-${id}-old.md`;
      return caseResult(
        [
          spec(path, `${enA} ${id} 점검 기준일`, [
            `# ${enA} ${id} 점검 기준일`,
            `${token} 점검 기준일은 2026-03-04이다.`,
            `기준일 이후 변경은 재점검 대상이다.`,
          ], [1]),
          spec(distractor, `${enA} ${id} 이전 기준일`, [`# ${enA} ${id} 이전 기준일`, `${token} 점검 기준일은 2026-04-03이다.`]),
        ],
        query(`dates-${index}`, ns, 'dates', koreanQuery(`${token} 점검 기준일 2026-03-04`), [
          { path, chunkIndex: 1 },
        ]),
      );
    }
    case 'duplicates': {
      const path = `${family('duplicates')}/${enA}-${id}.md`;
      const copy = `${family('duplicates')}/archive/${enA}-${id}-copy.md`;
      const body = `${token} 보존본은 아카이브에 두 벌로 남는다.`;
      return caseResult(
        [
          spec(path, `${enA} ${id} 보존본`, [`# ${enA} ${id} 보존본`, body], [1]),
          spec(copy, `${enA} ${id} 보존본 사본`, [`# ${enA} ${id} 보존본 사본`, body], [1]),
        ],
        query(`duplicates-${index}`, ns, 'duplicates', koreanQuery(`${token} 보존본`), [
          { path, chunkIndex: 1 },
          { path: copy, chunkIndex: 1 },
        ], { multiGold: true }),
      );
    }
    case 'multi-hop': {
      const start = `${family('multi-hop')}/${enA}-${id}.md`;
      const target = `${family('multi-hop')}/${enB}-${id}-bridge.md`;
      return caseResult(
        [
          spec(start, `${enA} ${id} 연결 노트`, [
            `# ${enA} ${id} 연결 노트`,
            `${token}은 다리 문서 ${bridge}을 참조한다.`,
          ], [1]),
          spec(target, `${enB} ${id} 다리 노트`, [
            `# ${enB} ${id} 다리 노트`,
            `${bridge} 담당자는 ${koB}이다.`,
          ], [1]),
        ],
        query(`multi-hop-${index}`, ns, 'multi-hop', koreanQuery(`${token} ${bridge} 담당자`), [
          { path: start, chunkIndex: 1 },
          { path: target, chunkIndex: 1 },
        ], { multiGold: true }),
      );
    }
    case 'phrase': {
      const path = `${family('phrase')}/${enA}-${id}.md`;
      const distractor = `${family('phrase')}/${enA}-${id}-scattered.md`;
      return caseResult(
        [
          spec(path, `${enA} ${id} 확인 로그`, [
            `# ${enA} ${id} 확인 로그`,
            `${token} 확인 결과 amber lattice recalibrated twice 상태다.`,
          ], [1]),
          spec(distractor, `${enA} ${id} 분산 로그`, [
            `# ${enA} ${id} 분산 로그`,
            `${token} 로그에 amber lattice 기록이 있고 recalibrated 항목은 twice 뒤에 남았다.`,
          ]),
        ],
        query(`phrase-${index}`, ns, 'phrase', englishQuery(`${token} amber lattice recalibrated twice`), [
          { path, chunkIndex: 1 },
        ]),
      );
    }
    case 'field-title': {
      const titleToken = `${enB}-${id}-titletoken`;
      const path = `${family('titles')}/${titleToken}.md`;
      return caseResult(
        [
          spec(path, `${enA} 운영 노트`, [
            `# ${enA} 운영 노트`,
            `운영 변경은 주간 회의에서 확정한다.`,
            `변경 이력은 지역 아카이브에 남긴다.`,
          ], [1]),
        ],
        query(`field-title-${index}`, ns, 'field-title', englishQuery(`notes for ${titleToken}`), [
          { path, chunkIndex: 1 },
        ]),
      );
    }
    case 'field-path': {
      const folderToken = `${ns}-${enB}-${index}-folder`;
      const path = `${folderToken}/${enA}-${id}.md`;
      const title = `${enA} ${id} 공간 노트`;
      return caseResult(
        [
          spec(path, title, [`# ${title}`, `공간 배치는 분기마다 갱신한다.`, `갱신 결과는 담당자에게 전달한다.`], [1]),
        ],
        query(`field-path-${index}`, ns, 'field-path', englishQuery(`folder ${folderToken} notes`), [
          { path, chunkIndex: 1 },
        ]),
      );
    }
    case 'conflict-pair': {
      const left = `${family('conflict')}/${enA}-${id}-a.md`;
      const right = `${family('conflict')}/${enA}-${id}-b.md`;
      return caseResult(
        [
          spec(left, `${enA} ${id} 주기 기록 A`, [
            `# ${enA} ${id} 주기 기록 A`,
            `${token} 주기 길이는 17이다.`,
          ], [1]),
          spec(right, `${enA} ${id} 주기 기록 B`, [
            `# ${enA} ${id} 주기 기록 B`,
            `${token} 주기 길이는 23이다.`,
          ], [1]),
        ],
        query(`conflict-pair-${index}`, ns, 'conflict-pair', koreanQuery(`${token} 주기 길이`), [
          { path: left, chunkIndex: 1 },
          { path: right, chunkIndex: 1 },
        ], { multiGold: true, conflictPair: true }),
      );
    }
    case 'no-answer': {
      // 코퍼스 어디에도 없는 토큰만 사용한다. 정답 구절은 비어 있다.
      // 하이픈 없이 붙여 토크나이저가 코퍼스 경로 조각(dv0 등)과 겹치지 않게 한다.
      const rare = `${NO_ANSWER_WORDS[0]}${id}q`;
      return caseResult(
        [],
        query(`no-answer-${index}`, ns, 'no-answer', englishQuery(`${rare} ${NO_ANSWER_WORDS[1]}`), [], {
          expectNoAnswer: true,
        }),
      );
    }
    default:
      throw new Error(`알 수 없는 범주: ${category}`);
  }
}

function caseResult(documents, queryRecord) {
  return { documents, query: queryRecord };
}

function spec(path, title, paragraphs, goldChunks = [], forbiddenChunks = []) {
  return { path, title, paragraphs, goldChunks, forbiddenChunks };
}

function query(id, ns, category, { text, language }, goldChunks, extra = {}) {
  return {
    id: `${id}-${ns}`,
    category,
    text,
    language,
    goldChunks,
    forbiddenChunks: [],
    expectNoAnswer: false,
    multiGold: false,
    conflictPair: false,
    ...extra,
  };
}

function buildFiller(index, ns, random) {
  const familyIndex = index % 16;
  const en = EN_NAMES[index % EN_NAMES.length];
  const jitter = Math.floor(random() * 400);
  const ko = KO_NAMES[(index + 3 + jitter) % KO_NAMES.length];
  const name = `${en}-fam${familyIndex}-${ns}`;
  const path = `${ns}-fam${familyIndex}/${en}-${index}.md`;
  const title = `${name} 기록`;
  // 케이스 골드 토큰·숫자·날짜·구문·정답없음 토큰은 재사용하지 않는다.
  return spec(path, title, [
    `# ${title}`,
    `${name} keeps ${ko} notes in the shared archive.`,
    `The ${name} queue processed ${500 + ((index + jitter) % 400)} entries during the 2027 cycle.`,
    `Review window follows the ${name} schedule.`,
  ]);
}

function assembleDocument(specification) {
  const lines = [];
  const chunks = [];
  specification.paragraphs.forEach((paragraph, index) => {
    const startLine = lines.length + 1;
    for (const line of paragraph.split('\n')) lines.push(line);
    chunks.push({ index, startLine, endLine: lines.length, text: paragraph });
    lines.push('');
  });
  const text = lines.join('\n');
  return {
    path: specification.path,
    title: specification.title,
    text,
    chunks,
    goldChunkIndexes: [...specification.goldChunks],
    forbiddenChunkIndexes: [...specification.forbiddenChunks],
    bytes: Buffer.byteLength(text, 'utf8'),
  };
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
