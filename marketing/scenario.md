# 사용 가치와 실제 UI 장면 후보

제작 기록 기준일: 2026-10-14. 이 문서는 촬영용 상황·반영한 합성 레이아웃·폐기된 시나리오의 이력이다. 지속 기준은 [마케팅 스펙](SPEC.md), 실행 지침은 [AGENTS.md](AGENTS.md)를 따른다. 당시 촬영·표시 설명을 현재 응답 방식·검색 품질의 검증으로 사용하지 않는다.

## 현재 사용하는 상황

| 상황 | 사용자가 원하는 변화 | 실제 UI로 보여 줄 수 있는 결과 |
| --- | --- | --- |
| 멈췄던 프로젝트 복귀 | 기록을 다시 파악하고 다음 행동을 정하기 | 결정·남은 질문을 정리한 답변 |
| 자료 비교·이해 | 따로 읽던 자료의 동의·차이를 함께 보기 | 비교 결과와 연결된 출처 |
| 내 자료로 집필 | 빈 페이지에서 글을 시작하기 | 개요와 사용자가 선택한 노트 활용 |

타깃의 고충은 자료를 찾고 기능 사이를 오가며 생각이 끊기는 것이다. 근거 확인은 판단을 돕고, 결과의 활용은 다음 작업을 이어 준다. 아래 과거 시나리오의 '답변보다 근거'를 현재 타깃 전체의 요구로 사용하지 않는다.

## 실제 제품 장면 · 반영 완료

8–12초는 에이전트 권장안이며 이번에는 35–45초의 10초 장면을 선택했다. 실제 제품의 정돈된 개요와 노트 링크를 보여 준다. 질문 입력·생성 대기·버튼 설명을 추가해 사용법 영상으로 바꾸지 않는다.

촬영용 자료는 테스트 볼트와 독립적으로 만든 합성 자료다. 현재 제품이 실제로 표시한 화면과 동작을 사용하며, 데이터 자체는 성능·정확성 입증에 사용하지 않는다. 질문 이후 응답은 모아서 수신하는 실제 동작을 따르고 삽입·저장은 사용자의 선택으로 보인다. 촬영 데이터 보호와 자동화 제한은 [engineering-contract.md](../engineering-contract.md)를 따른다. 여기의 모아서 수신한다는 설명은 촬영 시점의 기록이며 현행 스트리밍 계약을 대체하지 않는다.

현재 64초본에는 격리한 Obsidian 앱에서 촬영한 한영 제품 화면이 들어 있다. 합성 메시지를 실제 제품 렌더러에 표시한 레이아웃 예시이며 모델 호출·성능 검증은 하지 않았다. 자산의 출처는 영상 프로젝트의 `assets/product/provenance.json`에 기록한다. 하단의 '재현 데모 · 가상 문서' 표기는 사용하지 않는다. 아래 내용은 폐기된 이전안의 참고 자료이며 현재 화면의 재현 기준이 아니다.

<details>
<summary>과거 근거 시연안의 합성 시나리오 · 현재 제작 기준에서 제외</summary>

## 과거 가상 시나리오 — 리서치 리드의 프로젝트 재개

이 문서의 모든 인물·회사·파일·문구는 영상 제작을 위해 새로 만든 가상 데이터입니다. 실제 볼트와 테스트 볼트의 내용, 문서명, 고유 표현과는 무관합니다.

## 1. 페르소나

- 이름: 이수연 (가상 인물)
- 직업: 독립 리서치·기획 스튜디오 운영. 고객 프로젝트마다 회의록, 제안서, 계약서, 시장 보고서를 한 볼트에 모아 관리.
- 고충: 파일은 다 있지만 마크다운으로 옮길 시간은 없다. 몇 달 만에 재개된 프로젝트에서 예전 결정이 어디 있는지 찾는 데 매번 시간을 쓴다.
- 원하는 것: 답변보다 근거. 어떤 주장이 어느 문서의 어느 부분에서 나왔는지 바로 확인하고 싶다.

## 2. 합성 볼트 구조 (영상 화면에 등장)

```
Projects/Ferryline/
  2026-05-12-sprint-notes.md       회의록: 파일럿 범위를 두 도시로 한정하기로 결정
  Vendor-Proposal-Tidefield.pdf    벤더 제안서: 권장 파일럿 도시 4곳 (p.7)
  Market-Scan-2026.epub            시장 스캔 보고서
  Port-Authority-Guidelines.hwpx   항만 당국 가이드라인 (스캔 문서)
```

Ferryline, Tidefield, Port-Authority-Guidelines 등 모든 고유명사는 이 영상을 위해 만든 가상 이름입니다.

## 3. 장면별 흐름

### ASK (0:05–0:09)

입력창에 타이핑되는 질문:

> Compare the pilot scope decision in [[Projects/Ferryline/2026-05-12-sprint-notes.md]] with the recommendation in [[Projects/Ferryline/Vendor-Proposal-Tidefield.pdf]]. Where do they conflict? Cite the sources.

### ANSWER (0:09–0:16)

스트리밍되는 답변 핵심 문장:

> The sprint notes limit the pilot to two cities (scope decision, line 34). The Tidefield proposal recommends four cities (p.7, Recommended scope) — a direct conflict on pilot breadth.

### PROOF (0:16–0:24)

출처 패널 두 항목과 클릭 결과:

| 출처 | 위치 | 상태 | 클릭 결과 |
| --- | --- | --- | --- |
| 2026-05-12-sprint-notes.md | Scope decision — line 34 | ● 검증됨 | 노트 원문이 열리고 34번 줄 하이라이트 |
| Vendor-Proposal-Tidefield.pdf | p.7 — Recommended scope | ◆ 재검토 필요 | PDF 7쪽이 열리고 해당 단락 하이라이트 |

### HONESTY (0:24–0:28)

배지 두 개가 나란히 등장:

- ● Verified — cited passage matches the current note.
- ◆ Needs review — confirm the PDF section against the note context.

### FLOW (0:28–0:32)

인용구 삽입 결과 — 활성 노트에 아래 문장이 들어가고 커서가 다음 줄에서 깜빡임:

> Sprint notes limit the pilot to two cities; the Tidefield proposal recommends four ([[2026-05-12-sprint-notes]] L34, [[Vendor-Proposal-Tidefield.pdf]] p.7).

## 4. 화면 등장 합성 문구 요약

영상에 실제로 표시되는 텍스트는 위 질문·답변·출처·배지·인용 문장과 video-plan.md의 온스크린 문구뿐입니다. 그 외 볼트 내용은 화면에 등장하지 않습니다.

## 5. 제작 시 주의

- 이 시나리오는 창작이며, 저장소의 테스트 볼트나 어떤 실제 사용자 데이터와도 연결하지 않습니다.
- 화면의 파일명·문장을 바꿀 경우 이 문서를 함께 갱신해 기준을 유지합니다.

</details>
