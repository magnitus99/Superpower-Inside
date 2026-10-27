---
id: documentation-contract
type: architecture-design
status: draft
title: 문서 정본·근거와 이력의 소유권
parent: superpower-goals
references: [superpower-architecture, interface-design, search-quality, engineering-contract, release-contract, product-philosophy, philosophy-research, marketing-contract, brand-video-expression]
---

# 문서 정본·근거와 이력의 소유권

## 한 기준에는 한 정본

ThinkRail 스펙 그래프는 제품 의도·책임·경계·품질 요구의 정본이다. 경로를 바꾸기보다 기존 선언형 문서를 노드로 채택하고 혼합 문서의 지속 계약을 소유 스펙으로 이전한다. 새 초안은 내용 검토 전 draft로 유지하며 문서 import를 제품 합격·새 철학 승인으로 해석하지 않는다.

- `superpower-goals`: 제품 목적·범위. `product-philosophy`: 고객 가치·승인 원칙. `philosophy-research`: 그 근거를 해석하는 계약.
- `superpower-architecture` 및 모듈 SPEC: 구조·실패 경계·관찰한 구현 차이. `search-quality`: 전수검색·실제 답변의 품질 및 대조 기준.
- `interface-design`: 실제 제품의 화면 언어. `marketing-contract`·`brand-video-expression`: 사용자 가치 전달 및 브랜드 영상 표현. 앱 UI 규칙을 영상 문서에 복제하지 않는다.
- `engineering-contract`: 런타임 구현·데이터 보호·검증. `release-contract`: 버전·배포·제품 설명·수동 문구 검사.

AGENTS는 에이전트의 시작점·권한·실행 절차·관련 스펙 경로를 제공한다. 사람용 제품 기준을 그 안에 다시 길게 정의하지 않는다. 호환 링크/절은 이전 참조의 진입점일 뿐 두 번째 정본이 아니다. 그래프 ID는 spec_get으로, 본문은 반환된 파일에서 확인한다.

## 근거·이력·계획의 경계

[제품 철학 자료 입구](product-philosophy/00-index.md)는 조사·승인·예시·과거 기준을 목적별로 연결한다. 출처 카드·레지스트리는 당시 원문 확인 구간·날짜·한계이고, 승인 기록은 당시 응답·조건의 증거다. 그 자체를 현재 구현의 보증이나 새 실행 권한으로 쓰지 않는다. 가상 적용 예시·후보·과거 보존본은 현행 규범 노드로 승격하지 않는다.

[검색 품질 체크리스트](SEARCH-QUALITY-CHECKLIST.md)는 이번 브랜치의 미완료·할 일·실행 근거를 기록하는 정본이며 제품 SPEC이 아니다. 과거 회귀 결과·체크 상태·실제 답변 미달을 문서 마이그레이션으로 바꾸지 않는다. ThinkRail TODO는 현재 대화의 공유 실행 계획이고 체크리스트는 제품 품질의 지속 추적이다.

[마케팅 제작 기록](marketing/video-plan.md)·[장면 자료](marketing/scenario.md)·작품별 brief/frame/storyboard는 날짜·작품 범위의 참고다. 카피는 게시 문구 스냅샷이며 API·기능 계약이 아니다. 최신 제작 상태를 영구적인 길이·서체·모델·성능 기준으로 바꾸지 않는다.

## 원래 역할을 유지하는 문서

README는 사용자용 소개, LICENSE·THIRD_PARTY_NOTICES 및 자산별 라이선스는 법적 고지, tests/fixtures의 문서는 테스트 입력이다. 이들을 형식상 스펙으로 바꾸거나 설치본·외부 스킬(.agents)의 교재를 제품 정책으로 편입하지 않는다. 법적 고지와 테스트 입력은 보존한다.

simulations의 프로토타입·검수 산출물과 .commandcode의 도구 상태·취향 추론은 현재 기준이 아니다. 개인 설정(.thinkrail·.pi), 실제 볼트·평가 원문, 로그·렌더·캡처·폰트/라이브러리 자산은 문서 공개 대상에서 제외한다. 산출물의 설명에서 독립적인 제품 결정을 발견하면 사실을 확인해 소유 스펙에 기록하되 산출물 전체를 공개하지 않는다.

## 공개와 변경 경계

제품 철학 조사·사례·승인 자료와 공유 가능한 마케팅 텍스트는 사용자 요청에 따라 파일별 허용 목록으로 공유한다. 비밀·개인정보·로컬 대화 식별자·실제 볼트 원문은 공개하지 않는다. 공개용으로 제거한 식별정보는 승인 내용의 변경이 아니며, 의미·조건·승인 상태를 보존한다. 앞으로 생기는 파일까지 폴더째 자동 공개하지 않는다.

새 기준·승인 조건을 바꾸는 것은 별도 결정이다. 이후 계약과 과거 승인 수단이 다르면 날짜·역할·소유 스펙을 밝혀 둘을 구분하며 역사를 소급 수정하거나 과거 구현을 복원하지 않는다. 링크·그래프·공유 허용 범위와 원문 보존은 마이그레이션 검증 대상이며, 외부 링크가 지금도 유효하다는 보증과는 다르다.
