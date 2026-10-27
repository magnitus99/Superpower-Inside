# 커뮤니티 페이지 적용안

2026-10-14의 조사·카피·촬영 기록이며 실제 웹 편집·저장은 미실행이다. short-desc.txt·long-desc.txt는 당시 공개용 카피 스냅샷이지 현재 제품 스펙이 아니다. 아래 Codex CLI 문구 검사도 당시 실행 이력이며 현행 `release-contract`의 수동 pi 경로를 변경하지 않는다. 참조하는 캡처·검사 결과 JSON은 로컬 산출물로 남기며 이번 공유 문서에 포함하지 않는다. 지속 메시지·주장 경계는 [마케팅 스펙](../SPEC.md)을 따른다.

short-desc.txt와 long-desc.txt의 내용을 그대로 붙여 넣습니다. 각각 187자와 894자이며 줄바꿈을 포함한 값입니다.

카테고리는 AI를 Primary로 유지하고 Research와 Writing을 추가합니다. Sidebar와 Integrations는 해제합니다. 화면 위치·연결 수단보다 내 자료의 이해와 다음 작업으로 이어지는 사용 목적을 드러내는 선택입니다. 카테고리는 검색 필터와 같은 카테고리의 관련 플러그인 탐색에 관여하지만 순위 상승은 검증하지 않았습니다.

영어 이미지 업로드 순서:

1. screenshots/01-project.png — 프로젝트에 복귀하기
2. screenshots/02-research.png — 자료 비교하기
3. screenshots/04-draft.png — 비교를 초안으로 이어 가기
4. screenshots/03-sources.png — 필요한 순간 원문 확인하기
5. screenshots/05-unadorned.png — 장식 없는 화면

모든 이미지는 1200×800 PNG이며 각각 5 MB 미만입니다. 현재 작업 소스에서 빌드한 플러그인을 격리된 실제 Obsidian 앱에 설치하고 독립 합성 대화를 표시해 촬영했습니다. 대화·모델 설정·출처 상태는 촬영용 예시이고 모델을 호출하지 않았습니다. 화면의 출처 구간은 합성 원문과 대조했습니다. 노트 삽입은 실제 플러그인 동작을 실행하고 파일에 반영된 내용을 확인했습니다. UI의 구조·색·버튼을 새로 그리지 않고 캡처 밖의 제목·배경만 구성했습니다. 촬영용 볼트와 프로필은 삭제했습니다.

최종 영어 short desc와 long desc를 각각 Patina 9.1.0, Codex CLI gpt-6.1-sol/high로 온라인 검사했습니다. 두 문구 모두 실제 모델 점수 0, 최종 점수 0, 기준 15, 종료 코드 0입니다. patina-results.json에서 결과를 확인할 수 있습니다. 이 점수는 문체 검사 결과이며 제품 성능·검색 순위·설치 전환율을 측정한 결과가 아닙니다.

선정 근거:

- 공개 페이지의 description과 og:description은 현재 short desc와 일치했습니다. 웹 디렉터리에서 short desc의 source-aware는 해당 플러그인으로 검색됐고 long desc에만 있던 provenance는 해당 플러그인으로 검색되지 않았습니다. 이 관찰에 따라 핵심 단서를 short desc에 배치했으며 검색 알고리즘 전체를 추정하지 않았습니다.
- Reddit의 실제 사용자 질문에서 파일명·표현을 잊어도 자료를 찾고 싶은 요구, 의미 검색, 노트·PDF 대화와 출처 확인, 로컬 모델과 비용에 대한 요구를 확인했습니다. 질적 표본이며 검색량이나 전환율 자료는 아닙니다.
- 제품 철학의 최소 관여와 작업 흐름을 프로젝트 복귀·비교·글쓰기의 구체적인 결과로 표현했습니다. RAG·제공자 명칭은 검색 단서와 연결 판단에 필요한 범위로 넣었습니다.

참조:

- https://community.obsidian.md/plugins/superpower-inside
- https://community.obsidian.md/search?type=plugin
- https://obsidian.md/help/community-directory
- https://docs.obsidian.md/community-directory/manage-entry
- https://www.reddit.com/r/ObsidianMD/comments/1qqwyxc/how_are_you_guys_actually_searching_and_finding/
- https://www.reddit.com/r/ObsidianMD/comments/1f7hefi/what_is_your_favorite_ai_plugin_and_why/
- https://www.reddit.com/r/ObsidianMD/comments/1jcdt0b/any_unintrusive_and_privacyfriendly_ai_plugins/

편집 페이지의 입력값·카테고리·스크린샷·저장 상태는 변경하지 않았습니다.
