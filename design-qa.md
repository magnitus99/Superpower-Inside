# Design QA — 사이드바 채팅

## 기준

- 선택 시안: `/Users/kreimben/.codex/generated_images/019fa7c7-29a9-7a33-b6e3-b0d9f3c717f0/call_exZcijE4BPbNSSoHnXyu7Jj0.png`
- 실제 구현: `/Users/kreimben/.codex/visualizations/2026/07/28/019fa7c7-29a9-7a33-b6e3-b0d9f3c717f0/assistant-answer-420-light-definitive2.png`
- 최종 비교: `/Users/kreimben/.codex/visualizations/2026/07/28/019fa7c7-29a9-7a33-b6e3-b0d9f3c717f0/reference-vs-implementation-definitive.png`
- 환경: Obsidian 1.12.7, 오른쪽 사이드바 420 CSS px, DPR 2, 라이트 테마, 완료된 답변
- 범위: 시안의 핵심인 assistant 단일 응답 캔버스. 기존 Obsidian 상단 도구막대와 composer는 제품 문맥을 유지했다.

## 비교 이력

1. 첫 구현에서 답변, 작업 기록, 출처를 한 카드와 탭 구조로 통합했다.
2. 실제 Obsidian 검수에서 긴 도구 결과, 출처 밀도, 오류 행동 위계, 360px 헤더 줄바꿈을 조정했다.
3. 360px에서 composer가 하단 행동을 가리는 문제를 발견해 아이콘형 행동으로 압축했다.
4. 새 세션의 빈 상태가 분리된 DOM 참조 때문에 사라지는 문제를 재현하고 회귀 테스트와 함께 수정했다.
5. 선택 시안과 실제 구현을 한 이미지로 비교해 카드 위계, 간격, 타이포그래피, 탭, 상태, 근거 footer가 같은 방향으로 구현됐음을 확인했다.
6. 실제 저장 대화에서 답변 본문이 주변 13px UI보다 큰 16px로 렌더링되는 회귀를 확인했다.
7. 답변 본문 토큰과 행간을 사용자 말풍선과 같은 `--font-ui-small`·`1.6`으로 맞춘 뒤, 같은 대화와 같은 사이드바 폭에서 전후 이미지를 한 화면으로 비교했다.

## 답변 본문 타이포그래피 회귀 검수

- 수정 전: `/Users/kreimben/.codex/visualizations/2026/07/28/019fa7c7-29a9-7a33-b6e3-b0d9f3c717f0/font-size-2.1.0/before-sidebar.png`
- 수정 후: `/Users/kreimben/.codex/visualizations/2026/07/28/019fa7c7-29a9-7a33-b6e3-b0d9f3c717f0/font-size-2.1.0/after-sidebar.png`
- 직접 비교: `/Users/kreimben/.codex/visualizations/2026/07/28/019fa7c7-29a9-7a33-b6e3-b0d9f3c717f0/font-size-2.1.0/before-vs-after.png`
- 환경: Obsidian 1.12.7, 오른쪽 사이드바 708.5 CSS px, DPR 2, 라이트 테마, 같은 완료 답변
- 수정 전 계산값: 답변 `16px / 26.88px`, 사용자 말풍선 `13px / 20.8px`
- 수정 후 계산값: 답변 루트·문단·목록·사용자 말풍선 모두 `13px / 20.8px`
- 긴 경로 포함 답변의 가로 overflow: 없음
- 판정: P2 타이포그래피 불일치 해소, 주변 채팅 UI와 본문 밀도 일치

## 필수 표면

| 표면 | 증거 | 결과 |
| --- | --- | --- |
| 완료 답변 | `assistant-answer-420-light-definitive2.png` | 통과 |
| 작업 기록 | `assistant-work-420-light-final.png` | 통과 |
| 출처 5개 | `assistant-sources-420-light-final.png` | 통과 |
| 좁은 폭 | `assistant-answer-360-light-final2.png`, overflow 0 | 통과 |
| 다크 테마 | `assistant-answer-420-dark-final.png` | 통과 |
| 오류 | `assistant-error-420-light-final2.png` | 통과 |
| 진행 중 | `assistant-streaming-420-light-final.png` | 통과 |
| 빈 상태 | `chat-empty-420-light-final4.png` | 통과 |
| 키보드 | Tab focus-visible, ArrowRight 탭 전환, collapse 상태 복원 | 통과 |
| 접근성 | tablist/tab/tabpanel, aria-selected, aria-controls, aria-expanded, 텍스트 상태 | 통과 |
| 동작 | 복사, 재생성, 노트에 삽입, 새 노트, 브랜치 메뉴 | 통과 |

P0/P1/P2 미해결 항목 없음.

final result: passed
