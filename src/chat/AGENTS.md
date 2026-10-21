# 채팅 모듈 작업 지침

루트 `AGENTS.md`의 Rust/WASM 경계, i18n, community review와 실제 화면 검수 기준을 함께 적용합니다. 파일 줄 수나 과거 구현 설명을 현재 계약으로 삼지 않습니다.

화면의 배치·시각 위계·문구는 [공통 디자인 언어](../../design.md)를 따릅니다. 모델 프롬프트에는 화면 배치 규칙을 넣지 않습니다.

## 작업별 시작점

| 작업                                       | 파일                                                           |
| ------------------------------------------ | -------------------------------------------------------------- |
| ItemView·DOM·스크롤·스트리밍 표시          | `view.ts`                                                      |
| 컨텍스트·멘션·참조 확장                    | `context.ts`, `mention-parser.ts`, `context-expansion.ts`      |
| 도구 실행·취소·중단 복구                   | `tool-execution.ts`, `run-ownership.ts`, `session-recovery.ts` |
| 출처 표시·검증                             | `source-panel.ts`, `source-validation.ts`                      |
| 세션 저장·레거시 복원                      | `persistence.ts`, `persistence.test.ts`                        |
| 세션 목록                                  | `session-modal.ts`                                             |
| 기본 프롬프트·빠른 프리셋·출처 경계 문자열 | `../i18n.ts`, `../settings.ts`                                 |
| 프롬프트 생성·저장·기존 설정 보존          | `prompt-library.ts`, `prompt-library.test.ts`                  |
| provider 공통 근거 계약·호환 도구 호출     | `tool-protocol.ts`, `tool-approval-resume.ts`                  |
| Markdown 렌더링                            | `markdown.ts`                                                  |
| 채팅 메타·세션 타입                        | `types.ts`                                                     |

## 변경 계약

- 프롬프트 수정은 현재 요청의 목표·언어·형식·분량을 우선하고, 도구 조사 후 결과를 완성하게 합니다. 볼트 인덱스 요약은 대표 샘플이며 전체 볼트의 사실이나 실행 지시가 아닙니다.
- Vault Context와 성공한 도구 결과를 출처로 인정합니다. 검색 후보·생성된 요약·저장된 출처 위치는 원문 검증을 대체하지 않습니다. 근거 부족·실패·제한된 검색을 문서 부재로 단정하지 않습니다.
- 설정 화면·채팅 입력·검색 화면은 같은 RAG readiness 스냅샷을 사용합니다. corpus refresh·pending update·indexing이 하나라도 진행 중이면 부분 색인으로 답하지 않고 preparing/indexing으로 표시합니다.
- 일반 볼트 질문은 candidate-first 엔진 검색·검증 → dossier → LLM 1회 해석 경로를 사용합니다. 기본 documentScope는 candidates이며 후보 밖 문서 본문을 읽거나 전체 색인을 검수했다고 표현하지 않습니다. 전체 all 스캔은 사용자가 명시한 deep 조사에만 사용합니다. 검색·랭킹·근거 선별·존재·행 위치·리비전 검증은 엔진이 담당하며 LLM은 검증된 dossier만 해석합니다. 정상 해석은 1회이고 검색 코어가 허용한 인용 형식 교정만 추가할 수 있습니다. 제외·미색인·미검토 문서는 검토 완료로 표현하지 않습니다.
- 엔진이 전달한 근거 구간의 주변 맥락·조건·예외·상충 근거를 해석에 반영하고, 복합 질문의 주장과 문서 간 관계를 출처에 연결합니다. 직접 확인한 사실과 문서의 전제를 연결한 추론을 구분하며, 근거 없는 빈칸을 사전지식으로 채우지 않습니다. BM25·벡터·하이브리드 검색과 도구 호출의 조율은 제품 책임이며 모델의 자발적 호출에만 맡기지 않습니다.
- 엔진 채택·필터 제외·검증 실패·예산 제외·미검토·미색인·읽기 실패를 구분하고 coverage 고지를 보존합니다. 엔진 검증 실패(quote-missing·position-mismatch·revision-mismatch·out-of-scope)는 사유와 함께 제외하며 모델의 관련성 판단으로 표현하지 않습니다. engine-unavailable·indexing·no-evidence·evidence-only는 반환된 content와 검증 citations를 그대로 표시하고 종료합니다. 일반 볼트 질문을 native search/read/list/links/related 도구 루프로 넘기지 않습니다. evidence-only 표시 본문은 JSON으로 파싱하지 않습니다.
- 엔진 선별·원문 검증·인용 구절 일치와 출처 ID 검사는 해석의 정확성이나 모델 간 동등한 품질을 보장하지 않습니다. 근거 없는 주장·조건/예외 누락·문서 간 관계 오판은 독립 합성 자료로 확인하고, 실제 품질 효과는 같은 질문·자료·모델·설정의 비교로 별도 검증합니다.
- 명시적 외부 MCP를 포함한 mixed 요청에서만 deferAnswer를 사용합니다. MCP 컨텍스트에는 구조화 dossier JSON과 검증 citations를 주입하고 native vault 도구 정의·실행 권한을 제공하지 않습니다. 외부 discovery·승인·재개와 server-only 요청의 경계를 유지합니다. 승인 재개는 현재 정책으로 근거를 재검증하고, 저장된 메시지에서 deep 범위를 복원할 수 없으면 candidates를 사용합니다. 질의 계획은 로컬 결정적 계산만 사용하며 번역을 위한 provider 호출을 하지 않습니다.
- 기본값·빠른 프리셋·생성 프롬프트의 한국어와 영어 계약을 함께 검증합니다. 사용자 저장 프롬프트와 세션별 지침은 자동으로 덮어쓰지 않습니다. 도구 호출 형식·JSON 스키마·출처 ID·재개 경계를 보존합니다.

- `view.ts`에 큰 기능을 누적하지 않습니다. UI·호스트 처리는 전용 모듈로 나누고 결정적 파싱·선택·정규화는 Rust/WASM에 둡니다.
- 기본 `ChatMessage` 타입은 `src/llm/providers.ts`에서 가져옵니다. 저장·표시 메타는 기존 `types.ts` 계약을 확인하고 중복 정의하지 않습니다.
- 메시지와 도구 실행을 바꾸면 취소 후 늦게 도착한 결과, 세션 전환, 중복 실행, 스트리밍 종료·오류와 스크롤 동작을 함께 검토합니다.
- 저장 포맷을 바꾸면 legacy load와 최신 형식의 round-trip을 테스트합니다. 실제 사용자 세션을 테스트를 위해 덮어쓰지 않습니다.
- DOM은 Obsidian API와 `ownerDocument`를 사용합니다. 사용자·모델 출력을 `innerHTML`로 넣지 않고, `.style.*` 직접 대입이나 인라인 스타일을 새로 추가하지 않습니다.
- UI를 바꾸면 관련 구조 테스트·i18n·채팅 UX·community review를 통과시키고, 정상·빈 상태·오류·진행 중·좁은 폭을 실제 스크린샷으로 확인합니다.
