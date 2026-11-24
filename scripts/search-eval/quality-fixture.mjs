// 볼트·제품 tokenizer/planner와 독립적으로 수작업한 최소 정보 원장입니다.
const padding = Array.from({ length: 25 }, () => 'Routine inspection records retain descriptive labels and ordinary maintenance notes without another instruction.');

export const qualityFixture = {
  documents: [
    { path: 'synthetic/a.md', text: 'Quartz cooling protocol uses an amber reservoir.\nQuartz links the intake valve to the amber reservoir.\nQuartz restarts only after two cooling cycles.\nQuartz exception: during frost the intake remains closed.\nQuartz capacity is twelve units.' },
    { path: 'synthetic/b.md', text: 'Quartz conflicting register.\nQuartz capacity is fifteen units.' },
    { path: 'synthetic/copy.md', text: 'Quartz capacity is twelve units.' },
    { path: 'synthetic/noise.md', text: 'Quartz catalogue lists decorative colors.' },
    { path: 'excluded/hidden.md', text: 'Quartz secret excluded protocol.' },
    { path: 'synthetic/english.md', text: 'SOLSTICE threshold is seven amperes.\nSOLSTICE routing joins north and south.\nSOLSTICE exception keeps the south gate shut during ice.' },
    { path: 'synthetic/korean.md', text: '항구시험의 저장 한도는 일곱 단위다.\n항구시험은 북쪽 유입구와 남쪽 저장소를 연결한다.\n항구시험은 냉각 두 번을 마친 뒤에만 재개한다.\n항구시험은 결빙 중 유입구를 닫아 둔다.' },
    { path: 'synthetic/window.md', text: ['MERIDIAN begins with three sealed reservoirs.', ...padding, 'MERIDIAN starts only after the east inlet is locked.', ...padding, 'MERIDIAN exception keeps every reservoir sealed during frost.'].join('\n') },
    { path: 'synthetic/unicode.md', text: 'ＲＡＤＩＡＮＣＥ routes east.' },
    { path: 'synthetic/inside-word.md', text: 'Hypergammadelta retains the amber bypass during frost.' },
  ],
  cases: [{
    id: 'required-information', question: 'Quartz', terms: ['quartz'], hardExcludedPaths: ['excluded/hidden.md'],
    information: [
      { id: 'fact', kind: 'fact', path: 'synthetic/a.md', line: 1, text: 'Quartz cooling protocol uses an amber reservoir.' },
      { id: 'relation', kind: 'relation', path: 'synthetic/a.md', line: 2, text: 'Quartz links the intake valve to the amber reservoir.' },
      { id: 'condition', kind: 'condition', path: 'synthetic/a.md', line: 3, text: 'Quartz restarts only after two cooling cycles.' },
      { id: 'exception', kind: 'exception', path: 'synthetic/a.md', line: 4, text: 'Quartz exception: during frost the intake remains closed.' },
      { id: 'conflict-left', kind: 'conflict', path: 'synthetic/a.md', line: 5, text: 'Quartz capacity is twelve units.' },
      { id: 'conflict-right', kind: 'conflict', path: 'synthetic/b.md', line: 2, text: 'Quartz capacity is fifteen units.' },
    ],
  }, {
    id: 'no-answer', question: 'zynthar', terms: ['zynthar'], information: [], expectNoAnswer: true,
    hardExcludedPaths: ['excluded/hidden.md'],
  }, {
    id: 'hard-excluded-only', question: 'secret', terms: ['secret'], information: [], expectNoAnswer: true,
    hardExcludedPaths: ['excluded/hidden.md'],
  }, {
    id: 'english-relations', question: 'solstice', terms: ['solstice'], hardExcludedPaths: ['excluded/hidden.md'], information: [
      { id: 'threshold', kind: 'fact', path: 'synthetic/english.md', line: 1, text: 'SOLSTICE threshold is seven amperes.' },
      { id: 'routing', kind: 'relation', path: 'synthetic/english.md', line: 2, text: 'SOLSTICE routing joins north and south.' },
      { id: 'ice-exception', kind: 'exception', path: 'synthetic/english.md', line: 3, text: 'SOLSTICE exception keeps the south gate shut during ice.' },
    ],
  }, {
    id: 'korean-conditions', question: '항구시험', terms: ['항구시험'], hardExcludedPaths: ['excluded/hidden.md'], information: [
      { id: 'capacity', kind: 'fact', path: 'synthetic/korean.md', line: 1, text: '항구시험의 저장 한도는 일곱 단위다.' },
      { id: 'inlet-relation', kind: 'relation', path: 'synthetic/korean.md', line: 2, text: '항구시험은 북쪽 유입구와 남쪽 저장소를 연결한다.' },
      { id: 'restart-condition', kind: 'condition', path: 'synthetic/korean.md', line: 3, text: '항구시험은 냉각 두 번을 마친 뒤에만 재개한다.' },
      { id: 'frost-exception', kind: 'exception', path: 'synthetic/korean.md', line: 4, text: '항구시험은 결빙 중 유입구를 닫아 둔다.' },
    ],
  }, {
    id: 'multi-chunk-conditions', question: 'meridian', terms: ['meridian'], hardExcludedPaths: ['excluded/hidden.md'], information: [
      { id: 'reservoirs', kind: 'fact', path: 'synthetic/window.md', line: 1, text: 'MERIDIAN begins with three sealed reservoirs.' },
      { id: 'locked-condition', kind: 'condition', path: 'synthetic/window.md', line: 27, text: 'MERIDIAN starts only after the east inlet is locked.' },
      { id: 'sealed-exception', kind: 'exception', path: 'synthetic/window.md', line: 53, text: 'MERIDIAN exception keeps every reservoir sealed during frost.' },
    ],
  }, {
    id: 'normalized-body', question: 'radiance', terms: ['radiance'], hardExcludedPaths: ['excluded/hidden.md'], information: [
      { id: 'unicode-route', kind: 'relation', path: 'synthetic/unicode.md', line: 1, text: 'ＲＡＤＩＡＮＣＥ routes east.' },
    ],
  }, {
    id: 'literal-inside-word', question: 'gammad', terms: ['gammad'], hardExcludedPaths: ['excluded/hidden.md'], information: [
      { id: 'inside-word-condition', kind: 'condition', path: 'synthetic/inside-word.md', line: 1, text: 'Hypergammadelta retains the amber bypass during frost.' },
    ],
  }],
};
