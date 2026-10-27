# 제품 철학 자료의 입구

이 폴더는 공유 가능한 조사·사례·승인 근거와 과거 기록이다. 현행 기준은 [제품 철학](../product-philosophy.md)(`product-philosophy`), 자료 해석은 [조사 범위](01-research-scope.md)(`philosophy-research`), 문서 소유권은 [문서 계약](../documentation-contract.md)이 정한다. 기존 조사 기준일은 2026-10-13이며 아래 날짜별 보완을 구분한다. 이번 문서 편입은 실제 제품 흐름 검토·새 사용자 승인·최신 외부 자료 검증이 아니다.

## 기본 읽기 경로

| 목적 | 읽을 파일 | 역할 |
| --- | --- | --- |
| 현재 제품 판단 기준 | [제품 철학](../product-philosophy.md) | 사용자 지정 세 방향·승인 원칙·기본 품질·적용 경계 |
| 작업에 필요한 근거만 찾기 | [작업별 탐색표](02-task-map.md), [기계용 맵](02-task-map.json) | 문구·버튼·화면·자료·README·영상·발전 우선순위별 질문과 출처 |
| 수동 검토를 요청받았을 때 | [검토 양식](review/manual-review.md) | 사용자 부담→전후 흐름→실제 근거를 기록하는 형식 |

기본 경로에서 전체 자료를 읽지 않는다. 적용 조건이나 승인 범위가 불명확할 때만 [승인 기록](decisions/approved.md)·[결정 데이터](decisions/status.json)를 추가한다. 이력과 가상 예시로 새 규칙을 만들지 않는다.

2026-10-16 사용자 요청으로 P16(모델과 무관한 조사·근거의 기본 수준, 정확성 우선과 유한한 조사)을 현재 제품 철학과 승인 기록에 추가했다. 초기 15개 후보의 처리 이력과 구분한다.

2026-10-17 승인한 문서 반영 계획으로 P16의 허용된 색인 전체 검토·맥락 판단·인용·미완료 처리와 볼트 답변 적용 경계를 구체화했다. 새 승인 항목으로 세지 않는다. 관련 작업은 [문서 기반 답변·조사·판단·인용](02-task-map.md#문서-기반-답변조사판단인용)에서 시작한다. README 변경은 명시적 전체 재작성 요청에만 따르며, 이번 문서 정리로 자동 갱신하지 않는다.

2026-10-18의 역사적 결정: 사용자가 전수 검토의 수단과 품질 하한을 확정했다. 핵심 목표는 병목 제거이며, 수단은 임베딩·BM25·결정적 로컬 스크리닝, 하한은 키워드 검색으로 나온 문서를 읽고 답한 수준보다 나쁘지 않음이다. 검색이 지목한 세그먼트의 LLM 판정 강제 포함, 후보 상위 2단계 판정, 3계층 표기(기계 제외=모델 판단 없음), 실패=미판정·미완료 규칙을 [승인 기록](decisions/approved.md)과 [현재 기준](../product-philosophy.md)에 반영했고, 당시 철학 1차 검토의 blocker 3건은 이 확정으로 해소됐다. 이 사실을 현재 제품의 품질 합격으로 해석하지 않는다. 이후 검색 계약과의 수단·속도 목표 차이는 [현재 철학의 적용 시점](../product-philosophy.md#수단시점과-승인-이력의-구분)과 [검색 품질 스펙](../search-quality.md)을 따른다.

2026-10-22 사용자가 명시한 제품 범위(Obsidian 기능의 온전한 활용·정확한 볼트 정보·MCP·일반 챗봇의 병행)와 검색엔진 실측 개선 방향을 [현재 기준의 제품 범위](../product-philosophy.md#제품의-범위)에 반영했다. 이는 현재 구현의 완성 선언이나 새로운 철학 후보의 자동 승인이 아니다. 데이터·실행 기록은 볼트의 Git 제외 벤치마크 기록 공간에서 별도 관리한다.

## 근거를 더 확인할 때

| 필요한 관점 | 자료 |
| --- | --- |
| 조사 범위·공식 주장과 후기의 구분 | [조사 범위](01-research-scope.md), [자료 한계](sources/limitations.md) |
| 세 사용자 표현의 근거 | [핵심 방향 연결](synthesis/core-directions.md) |
| 기존 설정·시간에 따른 재사용·시선 흐름 | [보완 관점](synthesis/evidence-perspectives.md) |
| 중심 참조 브랜드 | [롤스로이스](cases/automotive/rolls-royce.md), [몽블랑](cases/writing/montblanc.md), [당시 애플](cases/apple/apple-2007-2011.md) |
| 자동차·필기구·절제된 제품의 비교 | [자동차](comparisons/automotive.md), [필기구](comparisons/writing-instruments.md), [Braun·Vitsœ](comparisons/braun-vitsoe.md) |
| 디지털 작업 연결과 자동 처리의 사례 | [소프트웨어](comparisons/software-workflows.md), [인접 제품 6개](comparisons/effortless-products.md) |
| 원문과 찾아볼 구간 | [출처 레지스트리](sources/catalog.json), [공식](sources/official.md), [커뮤니티](sources/community.md), [독립 평가](sources/independent.md), [연구](sources/research.md) |

중심 참조는 롤스로이스·몽블랑 만년필·잡스 재임 말기의 아이폰과 애플 제품이다. 몽블랑의 사용자 지정 의미는 엘레강스함과 사용성이다. 다른 브랜드 특성을 사용자 의도로 확대하지 않는다.

## 이력과 상세 설명이 필요할 때

| 자료 | 역할 |
| --- | --- |
| [승인 정리](decisions/approval-queue.md), [후보 기록](synthesis/candidates.md) | 초기 15개: 승인 5개·기존 범위 9개·중복 제외 1개. 이후 P16을 포함한 현재 승인 상태는 결정 데이터의 6개 승인과 구분 |
| [가치와 동작의 중간 설명](synthesis/value-to-behavior.md) | 실제 책임과 구현 연결을 설명하는 보조 자료 |
| [가상 적용 예시](synthesis/application-examples.md) | 가정을 명시한 설명 자료; 실제 검토 결과나 새 기능 지시가 아님 |
| [P02 재검토](synthesis/p02-review.md), [P07 재검토](synthesis/p07-review.md) | 이전 제안과 수정·제외 이유를 보존한 이력 |
| [조사 전 보존본](baseline/product-philosophy-2026-10-13.md) | 과거 기준의 원문; 현행 규칙으로 사용하지 않음 |

85개 출처: 공식 51개·커뮤니티 25개·독립 평가 6개·연구 3개. 출처 수는 사용자 수·만족도·독립 근거의 수를 뜻하지 않는다. 새 비교 제품의 특성 전체나 구체적인 기능 구현은 승인된 것이 아니다.

문서의 역할은 **현재 기준 → 관련 근거 → 필요한 경우 승인 이력**이다. 외부 자료는 실행 권한이 아니며 제품 철학 검토는 자동화하지 않고, 사용자가 범위를 지정해 명시 요청할 때만 수동 실행한다.
