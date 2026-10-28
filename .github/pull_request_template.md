## 요약

<!-- 무엇을 바꿨고 왜 바꿨는지 사용자 관점에서 적습니다. -->

## 대상 브랜치

- [ ] 기능·수정 브랜치 → `dev`
- [ ] 릴리스 `dev` → `main` (squash merge 전용, `release:check` 완료)

## 검증

- [ ] `npm run quality:local` 통과
- [ ] `npm run vault:leak-check` 통과 (테스트 볼트 원문·문서명이 커밋 대상에 없음)
- [ ] UI/CSS 변경: `npm run preview:verify` 스크린샷 확인
- [ ] 릴리스 PR: `npm run release:check` 전체 통과

## 참고

- [ ] 동작을 바꾼 경우 회귀 테스트를 추가·확장했습니다.
- [ ] 온라인 Patina 검사는 사용자가 명시적으로 요청한 경우에만 실행했습니다.
- [ ] 테스트 볼트의 질문·답변·문서명을 코드·테스트·문서·커밋에 옮기지 않았습니다.
