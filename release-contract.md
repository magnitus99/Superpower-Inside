---
id: release-contract
type: module-design
status: draft
title: 배포·제품 설명과 문구 검증 계약
parent: engineering-contract
references: [superpower-goals]
---

# 배포·제품 설명과 문구 검증 계약

## 버전과 배포

SemVer MAJOR.MINOR.PATCH를 사용하며 기능 추가는 minor, 버그·호환성 수정은 patch, 비호환 변경은 major다. 게시한 버전·태그는 보존한다. main에서 준비하고 manifest.json·package.json·package-lock.json 및 versions.json의 새 키를 맞춘다. 태그는 v 접두어 없는 정확한 버전이다. 버전 스크립트·검증·훅도 같은 형식을 처리한다.

릴리스는 사용자 요청 범위에서만 진행한다. workflow와 수동 Release 생성을 경합시키지 않고 전체 검사·게시 완료 후 자산을 확인한다. 같은 버전 재게시·태그 이동도 별도 요청 범위에 한한다.

릴리스 준비는 다음 전체 검증을 한 번 실행하고 실패하면 게시로 넘어가지 않는다. Patina는 이 경로에 자동 연결하지 않는다.

```fish
npm run security:full
and npm run build
and npm run review -- --tag (node -p "require('./manifest.json').version") --built
```

Release 노트는 직전 태그부터 현재 태그의 실제 이력을 근거로 사용자 체감 변화로 풀이한다. 커밋 문구를 복사하거나 버전 범프·재빌드 같은 내부 작업을 나열하지 않는다. 첫 릴리스는 전체 이력을 본다. 본문은 ## English → --- → ## 한국어 순서로 같은 내용을 완성하고 별도 노트 파일을 저장소에 커밋하지 않는다. 완료 전 gh release view <tag> --json body로 비어 있지 않은 한영 본문을 확인한다.

## README와 사용자 약속

README는 공개 제품 소개·사용 안내이며 개발 명세나 작업 이력이 아니다. 사용자가 명시적으로 전체 재작성을 요청할 때만 변경한다. 구현·철학·릴리스 변경이나 검사 실패는 자동 수정 권한이 아니다. 읽기 전용 대조에서 차이를 찾으면 보고하고 원본을 보존한다. 전체 재작성은 현재 기능·사용 흐름·사용자 가치를 통합하되 changelog·릴리스별 작업 문서로 바꾸지 않는다.

자동·무료·로컬·안전·지원이라는 약속은 실제 조건·예외에 맞춰 쓴다. 플러그인 무료 제공과 외부 모델 비용, 로컬 검색/OCR과 원격 채팅 전송, 합성 화면과 모델 실행을 구분한다. 영어·한국어의 의미와 행동 범위를 일치시킨다. 문장마다 대상 사용자의 이해와 문맥상 필요를 확인하되 변경 없는 모든 단어의 별도 보고서를 요구하지 않는다.

## 수동 문구 검증

Patina는 등록된 최종 사용자 문구의 영어·한국어를 수동으로 검사한다. 현재 대상은 README.md 하나이며 다른 사용자 문서는 scripts/check-copy.mjs의 copyDocuments에 명시 등록해야 한다. 개발 규칙·명세·법적 고지·테스트 자료·marketing/copy/releases·package/manifest description은 대상이 아니다. 커밋·푸시·CI·릴리스 자동화에 연결하지 않는다.

수동 호환 경로는 scripts/patina-bin/claude의 headless pi 실행이며 Codex CLI에 의존하지 않는다. 기본 모델은 openai/gpt-6.1-sol, 추론 high이며 PATINA_PI_MODEL·PATINA_PI_THINKING으로 명시 교체한다. 언어별 실제 모델 점수와 최종 점수가 모두 15 이하일 때만 통과한다. 최신 Patina 버전 확인 실패·인증 실패는 그대로 실패이며 오프라인 결과나 임의 제공자 전환으로 대체하지 않는다.

npm run copy:check 및 copy:check:online은 등록 문구 전체를 검사한다. 동일 문구·최신 버전·스크립트·shim·정책에서 통과한 전체 온라인 결과만 Git 내부에 7일 보관하며 원문은 저장하지 않는다. 만료·손상·내용/정책 변경이면 재검사하고 --refresh는 강제 재검사다. --release-ref <커밋> --offline은 결정적 검사일 뿐 실제 모델 점수가 아니다.

copy:fix는 명시적인 재작성 요청에만 사용한다. README에는 전체 재작성 권한이 추가로 필요하며 언어별 보정도 그 범위 안에서만 한다. 의미 보존·충실도 95 이상과 한영 온라인 재검사를 통과한 결과만 작업 파일에 반영하고 인덱스·커밋을 수정하지 않는다. 검토 후 다시 스테이징한다.

훅은 npm run hooks:install 또는 npm install로 설치한다. pre-commit은 스테이징 diff 형식만 검사하며 파일·인덱스를 재작성하지 않는다. 기존 게이트·품질 기준은 `engineering-contract`를 따른다. 이 명세는 자동 게시·모델 호출 권한을 부여하지 않는다.
