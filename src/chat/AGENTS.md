# 채팅 모듈 작업 지침

루트 AGENTS와 ThinkRail 내장 워크플로우를 적용합니다. 제품 계약은 이 파일에 복제하지 않고 다음 스펙에서 확인합니다.

## 작업별 시작점

| 대상 | 정본 스펙 | 주요 진입점 |
| --- | --- | --- |
| 대화 실행·세션·취소·저장·재개 | [SPEC.md](SPEC.md) (`chat-contract`) | view.ts·run-ownership.ts·retrieval-wait.ts·persistence.ts |
| 발견·현재 원문 검증·dossier·인용 | [../agent/SPEC.md](../agent/SPEC.md) (`vault-evidence`) | ../search/indexed-search-deps.ts·../agent/indexed-vault-review.ts |
| 검색 사이클·모델 공통 하한 | [../../search-quality.md](../../search-quality.md) (`search-quality`) | 종료 상태는 같은 문서의 검증 상태 절 |
| 화면·스크롤·스트리밍 표현 | [../../design.md](../../design.md) (`interface-design`) | assistant-response-layout.ts·source-panel.ts·markdown.ts |
| 프롬프트·컨텍스트·멘션 | [SPEC.md](SPEC.md) | context.ts·mention-parser.ts·context-expansion.ts·prompt-library.ts |
| 외부 도구·승인·재개 | [../mcp/SPEC.md](../mcp/SPEC.md) (`external-tools`) | tool-execution.ts·mcp-tool-execution.ts·tool-approval-resume.ts |
| 구현·i18n·데이터 보호·검증 | [../../engineering-contract.md](../../engineering-contract.md) | ../i18n.ts·../settings.ts·types.ts |

## 검색 개선 사이클의 시작점

`search-quality`의 실제 최종 답변·전수검색 대조를 먼저 수행합니다. 기록된 미완료와 남은 실행 항목은 `search-quality`의 검증 상태 절과 ThinkRail TODO에서 이어가며, 이 표를 별도 활성 작업 목록으로 사용하지 않습니다.

## 변경 계약

근거·비교 facet·집계·실패·교정·후속 조사 요구는 `vault-evidence`, 실행·준비 대기·mixed·저장 계약은 `chat-contract`로 이전했습니다. 스펙의 목표와 확인된 구현 차이를 함께 읽습니다. 기본 ChatMessage는 ../llm/providers.ts에서 가져오고 저장/표시 메타는 기존 types.ts를 확인합니다.

view.ts에 큰 기능을 누적하지 않습니다. UI·호스트 조율은 전용 모듈, 결정적 파싱·선택·정규화는 Rust/WASM에 둡니다. 메시지·도구 변경에는 취소 후 늦은 결과·세션 전환·중복 실행·스트리밍 종료/오류·스크롤을, 저장 변경에는 legacy load·round-trip을 함께 검토합니다. 실제 사용자 세션을 테스트로 덮어쓰지 않습니다. 화면 변경의 구조·i18n·UX·community review·실제 스크린샷 의무는 `engineering-contract`를 따릅니다.
