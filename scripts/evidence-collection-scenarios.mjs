// 실제 볼트와 독립적으로 만든 언어·자료 규모가 다른 회귀 사례입니다.
export function createEvidenceCollectionCases() {
  return [
    {
      question: 'Compare copper ledger and glass index resilience',
      sources: [
        {
          path: 'Research/Copper.md',
          text: 'Copper ledger resilience preserves ordered writes. Concurrent readers require a separate checkpoint.',
        },
        {
          path: 'Research/Glass.md',
          text: 'Glass index resilience isolates readers. Concurrent writes may require rebuilding a partition.',
        },
      ],
    },
    {
      question: '종이 센서와 나무 계측기의 오차 차이를 비교해줘',
      sources: [
        {
          path: 'Research/Paper.md',
          text: '종이 센서는 습도 오차가 크다. 다만 건조 조건에서는 보정이 안정적이다.',
        },
        {
          path: 'Research/Wood.md',
          text: '나무 계측기는 온도 오차가 크다. 습도 변화에는 별도의 보정이 필요하다.',
        },
      ],
    },
    {
      question: 'How does the mica relay restart safely, including its waiting period?',
      sources: [
        {
          path: 'Research/Introduction.md',
          text: 'Mica relay restart instructions are recorded under the name quartz handshake. This note does not contain the waiting period.',
        },
        {
          path: 'Research/Procedure.md',
          text: 'Quartz handshake: keep input disabled, wait two cycles, then enable output.',
        },
      ],
    },
  ].map(({ question, sources }, index) => ({
    id: `managed-evidence-${index}`,
    workflow: 'evidence-collection',
    question,
    scopes: ['Research'],
    requiredSources: sources.map((source) => source.path),
    files: [
      ...Array.from({ length: 2001 }, (_, offset) => ({
        path: `Archive/Unrelated-${offset}.md`,
        text: `합성 일정 기록 ${offset}. 배송과 행사 준비 상태.`,
      })),
      ...sources,
    ],
  }));
}
