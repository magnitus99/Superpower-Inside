# 릴리스 작업 계약

- 플러그인 버전은 SemVer `x.y.z` 형식을 사용하고, `manifest.json`, `package.json`, `versions.json`을 항상 함께 갱신한다.
- `versions.json`은 플러그인 버전을 키로, 해당 버전의 최소 Obsidian 버전을 값으로 기록한다. 예: `"1.0.0": "0.15.0"`.
- Obsidian 커뮤니티 제출/배포는 `manifest.json.version`과 **완전히 같은 이름의 GitHub Release 태그**를 찾는다. `manifest.json.version`이 `1.0.0`이면 태그도 반드시 `1.0.0`이어야 하며, `v1.0.0`만 만들면 커뮤니티 제출 화면에서 릴리스를 찾지 못한다.
- GitHub Release에는 `manifest.json`, `main.js`, `styles.css`, `tern_engine_bg.wasm`, `THIRD_PARTY_NOTICES.md` 다섯 asset이 포함되어야 한다. `main.js`는 `npm run build` 결과물이어야 한다.
- 릴리스 전 검증은 `npm ci`, `npm run security:full`, `npm run build` 순서로 확인한다. CI와 동일한 npm 계열에서 `package-lock.json`이 `package.json`과 동기화되어야 한다.
- 릴리스 전후에는 `npm run review -- --tag <version> --built`를 실행해 release asset 기준 Obsidian review gate를 통과시킨다.
- 릴리스 절차에는 별도 비주얼 체크나 스크린샷 확인 단계를 넣지 않는다. 릴리스 검증은 `security:full`, `build`, Obsidian review gate, GitHub Release asset 확인으로 끝낸다.
- `package-lock.json`은 추적 대상이다. 의존성 변경이나 npm CI 실패를 수정할 때는 lockfile을 함께 갱신하고 커밋한다.
- Obsidian 플러그인 스토어 출시와 업데이트는 별도 릴리스 브랜치나 PR 브랜치를 만들지 않고 `main` 브랜치에서 직접 준비한다.
- 커뮤니티 제출 시스템은 기본 브랜치의 `manifest.json`과 동일 버전 GitHub Release 태그를 기준으로 삼는다. 따라서 릴리스 버전 변경은 `main`에 커밋하고, 버전명과 완전히 같은 태그만 생성해 관리한다.
- 릴리즈 준비 시 `release-notes-*.md`나 업데이트 로그 문서를 만들지 않는다. 사용자에게 의미 있는 새 기능이 있으면 `README.md`의 현재 기능 설명에 통합하고, 릴리즈별 업데이트 요약은 repo에 커밋하지 말고 GitHub Release 본문에 직접 붙여 넣는다.
- 출시 이력과 업데이트 관리는 브랜치가 아니라 태그로만 추적한다. 예: `1.0.0`, `1.0.1`, `1.1.0`.
- 같은 버전을 재출시할 때는 새 버전으로 올리지 말고 해당 버전 태그를 새 커밋으로 이동한다. 순서: `main` 푸시 → `git tag -f <version>` → `git push --force origin <version>` → Release workflow 완료 대기 → `gh release view <version> --json assets,tagName,targetCommitish,url`로 workflow에 명시된 asset 5개 확인.
- Release workflow가 tag push로 실행 중이거나 실행될 예정이면 같은 태그에 대해 수동 `gh release create`를 먼저 실행하지 않는다. workflow가 기존 asset을 지우고 다시 올리는 중 실패하면 `main.js` 누락 릴리즈가 생길 수 있다.
- 릴리즈 완료 후 `gh release view <version> --json assets`에서 `manifest.json`, `main.js`, `styles.css`, `tern_engine_bg.wasm`, `THIRD_PARTY_NOTICES.md`가 모두 있고, 가능하면 `gh attestation verify main.js --repo magnitus99/Superpower-Inside`, `gh attestation verify styles.css --repo magnitus99/Superpower-Inside`, `gh attestation verify manifest.json --repo magnitus99/Superpower-Inside`까지 확인한다.


자산 목록의 현재 기준은 `.github/workflows/release.yml`입니다. 커밋·태그·푸시·재출시는 사용자가 요청한 범위에서만 실행합니다.
