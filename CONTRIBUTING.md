# Contributing

전체 작업 계약은 [AGENTS.md](AGENTS.md)를 따릅니다. 이 문서는 브랜치·릴리스·검사 명령만 요약합니다.

## 브랜치

- `main`: 릴리스 전용. 직접 커밋·push하지 않고 `dev` PR만 squash merge합니다. 태그와 GitHub Release만 남깁니다.
- `dev`: 개발 허브. AGENTS의 변경 범위 검증·독립 리뷰·사용자 요청 권한에 따라 직접 작업 또는 로컬 작업 브랜치 통합 후 push할 수 있으며 릴리스 버전을 준비합니다. `main`을 `dev`로 merge하지 않습니다.
- 작업 브랜치를 사용하면 `<type>/<short-slug>` (예: `feat/search-dossier`, `fix/window-close`) 형식을 따릅니다. 원격 push는 필수가 아니며 `dev` PR은 원격 협업 등에 선택합니다.

## 릴리스

```text
# dev에서
npm run release:check
npm run release:bump -- patch   # 또는 minor / major

# dev -> main PR을 squash merge한 뒤 main에서
git pull
npm run release:tag
git push origin <방금 생성한 버전 태그>
```

명령은 한 줄씩 실행하고 실패하면 다음 단계로 넘어가지 않습니다. `<방금 생성한 버전 태그>`는 실제 버전 번호로 바꿉니다. 태그는 SemVer(`x.y.z`)이며 `v`를 붙이지 않습니다. `release:tag`는 `dev`와 `main`의 내용 일치, 버전, 태그 위치를 확인하고, Release workflow는 같은 조건과 커밋된 자산을 다시 검증한 뒤 초안 Release를 만듭니다. Release 본문은 영어·한국어를 모두 작성한 뒤 게시합니다.

## 저장소 보호 설정 (관리자 1회)

- `main`: Require a pull request before merging, Require status checks(`Quality`), Require linear history, squash merge만 허용, force push·직접 push 금지.
- `dev`: PR 강제 없이 로컬 검증·독립 리뷰 후 직접 push를 허용하고, PR을 사용하면 `Quality` 통과를 요구합니다. force push는 금지합니다.
- 릴리스 태그는 `main`의 `dev` squash merge 커밋에만 만들고, `v` 접두사를 붙이지 않습니다.

## 검사

저장소의 개발·검증 진입점은 Windows·macOS·Linux 공통으로 Node/npm을 사용합니다. 작업에 따라 네이티브 Git·Rust 도구 등이 필요하며, 앱 실행처럼 OS별 전제가 있는 명령은 해당 스크립트의 안내를 따릅니다.

- `pre-commit`: 스테이징 diff 형식과 스테이징 파일의 테스트 볼트 유출.
- `pre-push`: `quality:local --base <원격 기준>`으로 변경 범위 검사. `main` 직접 push는 차단됩니다.
- `npm run quality:local`: 변경 범위에 따라 lint·typecheck·Vitest·계약 검사·Rust 검사를 선택합니다.
- `npm test`: 전체 Vitest + i18n·채팅 UX·오프라인 채팅 계약 + 볼트 유출.
- `npm run security:full`: 릴리스 PR과 의존성·보안 변경의 전체 게이트.
- UI/CSS 변경: `npm run preview:verify`로 헤드리스 Chrome 고정 뷰포트 DOM 계약과 스크린샷을 확인합니다.

테스트 볼트(`.test-vault/`)와 그 안의 시나리오·질문·답변·문서명은 커밋하지 않습니다. 로컬 검증에만 사용하고, 필요한 임시 산출물은 Git 제외 경로에 격리한 뒤 정리합니다.
