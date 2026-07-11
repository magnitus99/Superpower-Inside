# Providers 작업 중심 설정 UI 구현 계획

## 성공 기준

- Providers 탭이 현재 상태와 연결 목록 순서로 읽힌다.
- provider는 공통 disclosure로 한 번에 하나만 펼쳐진다.
- 펼친 provider는 연결 설정, 일반 모델, 임베딩 모델, 위험 작업 순서다.
- 기존 설정·모델 관리·검증 동작을 보존하고 전체 자동·비주얼 게이트를 통과한다.

## 작업 순서

1. `src/settings-redesign.test.ts`에 새 section 순서, 단일 primary action, provider disclosure, 위험 작업 계약을 먼저 추가한다.
2. `buildProvidersTab`과 `buildProviderProfilesTab`을 공통 workspace, 상태 section, 연결 section으로 분리한다.
3. 기존 provider hero card를 공통 disclosure 기반 profile row로 교체한다.
4. 연결 설정을 평평한 setting row로 옮기고 API key·strategy callback을 유지한다.
5. 일반/임베딩 모델 관리 표면을 공통 row와 disclosure 언어로 정리한다.
6. provider 제거를 danger disclosure와 확인 gate 안으로 옮긴다.
7. 한국어·영어 i18n, CSS, 개발 문서와 시각 QA 표를 갱신한다.
8. 관련 테스트를 반복한 뒤 `security:full`, build, review gate를 실행한다.
9. `.test-vault` 실제 Obsidian에서 상태·접힘·모델·위험 영역·좁은 폭·light/dark를 스크린샷 검수한다.
10. 소스와 bundle을 논리적으로 분리 커밋하고 clean worktree를 확인한다.
