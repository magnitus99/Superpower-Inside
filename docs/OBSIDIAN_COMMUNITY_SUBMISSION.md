# Obsidian 커뮤니티 플러그인 제출 가이드

## 사전 체크리스트

제출 전 반드시 확인해야 할 항목들입니다.

### 필수 파일

- [ ] `manifest.json` — 모든 필수 필드 포함, 버전 유효
- [ ] `main.js` — production 빌드 산출물
- [ ] `styles.css` — (해당 시) 스타일 파일
- [ ] `README.md` — 설명, 설치법, 사용법 포함

### manifest.json 필수 필드

```json
{
  "id": "super-obsidian-by-ai",
  "name": "Super Obsidian by AI",
  "version": "x.y.z",
  "minAppVersion": "0.15.0",
  "description": "...",
  "author": "...",
  "isDesktopOnly": false
}
```

### 기능 검증

- [ ] 플러그인이 Obsidian에서 오류 없이 로드됨
- [ ] 설정 탭이 정상적으로 열림
- [ ] 기본 명령어가 동작함
- [ ] 사이드바 뷰가 정상 표시됨
- [ ] `isDesktopOnly: false`인 경우 모바일에서도 테스트 완료

### 릴리스 검증

- [ ] GitHub Release에 `manifest.json`, `main.js`, `styles.css` 첨부됨
- [ ] Release 태그 버전 == manifest.json 버전 == package.json 버전
- [ ] Release 노트에 변경사항 요약 포함

---

## 제출 절차

### 1단계: 릴리스 준비

```bash
# 버전 업 (patch / minor / major)
./scripts/bump-version.fish minor

# GitHub Actions가 자동으로 Release를 생성합니다.
# https://github.com/magnitus99/Super-Obsidian-by-AI/actions
```

### 2단계: 릴리스 확인

GitHub Releases 페이지에서 다음을 확인:

1. 태그가 `vX.Y.Z` 형식인지
2. `manifest.json`, `main.js`, `styles.css` 3개 파일이 첨부되어 있는지
3. Release 노트가 적절한지

### 3단계: obsidian-releases PR 생성

1. [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) 포크
2. `community-plugins.json`에 다음 항목 추가 (알파벳 순):

```json
{
  "id": "super-obsidian-by-ai",
  "name": "Super Obsidian by AI",
  "author": "Super Obsidian Team",
  "description": "LLM, RAG, MCP, internet search, and sidebar chat for Obsidian",
  "repo": "magnitus99/Super-Obsidian-by-AI",
  "branch": "main"
}
```

3. PR 제목: `Add super-obsidian-by-ai plugin`
4. PR 본문에 다음 포함:
   - 플러그인 설명 (1-2문장)
   - GitHub repo 링크
   - 최신 release 링크
   - manifest.json 필수 필드 확인 완료 표시

### 4단계: 대기

- Obsidian 팀이 PR을 검토합니다 (보통 며칠 ~ 몇 주)
- 요청 시 수정사항을 반영합니다
- 승인되면 커뮤니티 플러그인 목록에 표시됩니다

---

## 업데이트 절차

새 버전 출시 후:

1. `./scripts/bump-version.fish patch` (또는 minor/major)
2. GitHub Release 자동 생성 확인
3. obsidian-releases에 **별도 PR 불필요** — Obsidian이 주기적으로 release를 감지하여 자동 업데이트

---

## 참고

- [Obsidian 커뮤니티 플러그인 가이드](https://docs.obsidian.md/Plugins/Getting+started/Submit+your+plugin)
- [obsidian-releases README](https://github.com/obsidianmd/obsidian-releases/blob/master/README.md)
