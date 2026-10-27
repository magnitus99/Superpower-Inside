# 작업별 근거 탐색

먼저 [핵심 기준](../product-philosophy.md)을 읽고 작업에 해당하는 행만 고른다. P-ID는 검토 초점이며 다른 승인 조건을 생략하는 근거가 아니다. 실제 동작의 근거는 해당 구현·호출부·테스트에서 확인한다. 참조 제품의 사례는 그 판단의 이유를 이해하는 자료다.

| 작업 | 초점 원칙 | 첫 질문 | 시작할 출처 |
| --- | --- | --- | --- |
| 화면·시선 흐름·상태 표현 | K01 · P04 · P09 · P02 | 필요한 정보와 다음 행동을 찾는 부담이 줄어드는가? | CD02 · AP06 · SW10 |
| 버튼·행동·상태 전환 | P01 · P02 · P04 | 이 행동이 필요한 이유와 다음 단계에 전달할 것은 무엇인가? | RR01 · RR02 · RS01 |
| 사용자 표시 문구 | P04 · P02 · P09 | 어떤 상태에서 어떤 판단·행동을 돕기 위해 보여 주는가? | AP06 · CD02 · RS01 |
| README·제품 설명 | P01 · P02 · P04 · P09 | 대상 사용자가 어떤 작업과 연결된 흐름을 이해하게 하는가? | AP01 · AP05 · CD02 |
| Rust/WASM·자료 처리·검색 연결 | P01 · P02 · P05 | 입출력이 다음 단계에 필요한 본문·출처·확인 상태를 보존하는가? | RR01 · AP05 · SW02 |
| 문서 기반 답변·조사·판단·인용 | P16 · P01 · P02 · P04 | 전체 lexical 발견·후보 보존·현재 원문 검증·최종 답변이 공통 품질 하한을 충족하는가? | P16 사용자 승인 기록·현재 구현·합성 테스트 |
| 영상·마케팅 | P01 · P02 · P04 · P09 | 장면·문구가 전달하는 편안함이 실제 가능한 경험인가? | AP01 · AP05 · CD02 |
| 새 기능·기존 개선·기술 변화 | P05 · P01 · P02 · P09 | 같은 목적에서 전체 흐름의 부담을 더 줄이는 쪽은 무엇인가? | RR03 · AP05 · CD02 |

출처는 [레지스트리](sources/catalog.json)의 ID로 공식 주장·후기·확인 구간·한계를 확인한다. 충분하면 더 읽지 않는다. 문장·조건의 범위가 불명확할 때만 [승인 기록](decisions/approved.md)을 추가한다. 수동 검토 요청이 있을 때는 [양식](review/manual-review.md)을 사용한다.

## 화면·시선 흐름·상태 표현

- 판단 질문: 필요한 정보와 다음 행동을 찾는 부담이 줄어드는가? / 읽는 위치·목적·자료 범위를 다시 파악하게 하는가? / 정돈됨과 세심함이 실제 사용 흐름과 연결되는가?
- 작업 계약·현재 대상: [AGENTS.md](../AGENTS.md), [design.md](../design.md), [src/chat/AGENTS.md](../src/chat/AGENTS.md)
- 필요할 때 볼 근거: [evidence-perspectives.md](../product-philosophy/synthesis/evidence-perspectives.md), [braun-vitsoe.md](../product-philosophy/comparisons/braun-vitsoe.md)
- 출처 ID: CD02 · AP06 · SW10

## 버튼·행동·상태 전환

- 판단 질문: 이 행동이 필요한 이유와 다음 단계에 전달할 것은 무엇인가? / 이름·실제 효과·부작용·중단 범위가 일치하는가? / 준비·실패·복구 때문에 사용자가 기존 작업을 반복해야 하는가?
- 작업 계약·현재 대상: [AGENTS.md](../AGENTS.md), [design.md](../design.md), [src/chat/AGENTS.md](../src/chat/AGENTS.md)
- 필요할 때 볼 근거: [rolls-royce.md](../product-philosophy/cases/automotive/rolls-royce.md), [value-to-behavior.md](../product-philosophy/synthesis/value-to-behavior.md)
- 출처 ID: RR01 · RR02 · RS01

## 사용자 표시 문구

- 판단 질문: 어떤 상태에서 어떤 판단·행동을 돕기 위해 보여 주는가? / 실제 처리 범위와 약속·한계가 같은가? / 같은 동작의 명칭과 한국어·영어의 의미가 일치하는가?
- 작업 계약·현재 대상: [AGENTS.md](../AGENTS.md), [design.md](../design.md), [src/i18n.ts](../src/i18n.ts)
- 필요할 때 볼 근거: [apple-2007-2011.md](../product-philosophy/cases/apple/apple-2007-2011.md)
- 출처 ID: AP06 · CD02 · RS01

## README·제품 설명

- 적용 조건: 읽기 전용 검토 또는 사용자가 명시적으로 지시한 전체 재작성. 다른 작업의 후속 단계로 README 갱신을 자동 시작하지 않으며 루트 AGENTS.md의 계약을 따른다.
- 판단 질문: 대상 사용자가 어떤 작업과 연결된 흐름을 이해하게 하는가? / 각 단어의 필요성과 실제 적용 조건을 설명할 수 있는가? / 자동·무료·로컬·지원의 범위와 예외가 사실에 맞는가?
- 작업 계약·현재 대상: [AGENTS.md](../AGENTS.md), [README.md](../README.md)
- 필요할 때 볼 근거: [apple-2007-2011.md](../product-philosophy/cases/apple/apple-2007-2011.md), [value-to-behavior.md](../product-philosophy/synthesis/value-to-behavior.md)
- 출처 ID: AP01 · AP05 · CD02

## Rust/WASM·자료 처리·검색 연결

- 판단 질문: 입출력이 다음 단계에 필요한 본문·출처·확인 상태를 보존하는가? / 제한된 경로나 결과를 충분한 처리로 표현하는가? / 같은 목적에서 전후 관여·재작업·결과 활용이 어떻게 달라지는가?
- 작업 계약·현재 대상: [AGENTS.md](../AGENTS.md)
- 필요할 때 볼 근거: [evidence-perspectives.md](../product-philosophy/synthesis/evidence-perspectives.md), [value-to-behavior.md](../product-philosophy/synthesis/value-to-behavior.md)
- 출처 ID: RR01 · AP05 · SW02

## 영상·마케팅

- 판단 질문: 장면·문구가 전달하는 편안함이 실제 가능한 경험인가? / 앞뒤 단계의 연결과 생략된 조건을 사실에 맞게 설명하는가? / 기술의 수고보다 사용자가 얻는 결과와 사용 경험이 전면에 오는가?
- 작업 계약·현재 대상: [AGENTS.md](../AGENTS.md), [README.md](../README.md)
- 필요할 때 볼 근거: [apple-2007-2011.md](../product-philosophy/cases/apple/apple-2007-2011.md)
- 출처 ID: AP01 · AP05 · CD02

## 새 기능·기존 개선·기술 변화

- 판단 질문: 같은 목적에서 전체 흐름의 부담을 더 줄이는 쪽은 무엇인가? / 늘어나는 관리·판단 부담과 기존 흐름에 미치는 영향은 무엇인가? / 새로움이나 기존 완성도만을 이유로 우선순위를 고정하는가?
- 작업 계약·현재 대상: [AGENTS.md](../AGENTS.md)
- 필요할 때 볼 근거: [rolls-royce.md](../product-philosophy/cases/automotive/rolls-royce.md), [evidence-perspectives.md](../product-philosophy/synthesis/evidence-perspectives.md)
- 출처 ID: RR03 · AP05 · CD02

## 문서 기반 답변·조사·판단·인용

- 판단 질문: 같은 범위·일치 조건의 Ctrl+F 발견 결과와 읽을 수 있는 맥락을 발견·검증·전달·후속 조사·최종 답변에서 잃지 않는가? / 채택·제외와 미검토·읽기 실패를 구분하는가? / 모델별 실제 최종 답변의 내용 하한과 근거 정확성을 각각 확인했는가? / 사실·추론과 외부 근거의 경계를 유지했는가?
- 현행 수단·검증 정본: [품질 요구](../goal-and-requirements.md#품질-요구), [검증 상태](../engineering-contract.md#검증-상태와-이력), [src/agent/SPEC.md](../src/agent/SPEC.md). 과거 screen→extract·강제 LLM 판정의 승인 이력은 현행 구현 지시와 구분한다.
- 작업 계약·현재 대상: [AGENTS.md](../AGENTS.md), [src/chat/AGENTS.md](../src/chat/AGENTS.md), [색인 전체 검토](../src/agent/indexed-vault-review.ts), [합성 회귀 테스트](../src/agent/indexed-vault-review.test.ts), [Rust 검증](../crates/rag-wasm/src/indexed_review.rs)
- 필요할 때 볼 근거: [P16 기준](../product-philosophy.md#조사와-근거의-책임), [사용자 승인 기록](decisions/approved.md), [결정 데이터](decisions/status.json)
- 출처 ID: 없음. 사용자 직접 지시와 현재 구현·테스트를 근거로 하며, 외부 브랜드 사례를 이 원칙의 승인 근거로 사용하지 않는다. 실제 동작과 기준의 차이 및 품질 검증 한계는 구분한다.

## 기계가 읽는 동일한 탐색표

[02-task-map.json](02-task-map.json)은 원칙 ID·관련 경로·출처 ID를 제공한다. 모든 경로는 저장소 루트 기준이다. 이 파일은 새 규칙·승인·자동 실행 설정이 아니다.
