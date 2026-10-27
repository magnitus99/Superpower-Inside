---
id: superpower-goals
type: goal-and-requirements
status: draft
title: 제품 목표와 품질 요구사항
tags: [product]
references: [vault-evidence, interface-design, product-philosophy, search-quality, documentation-contract, marketing-contract]
---

# 제품 목표와 품질 요구사항

## 목적과 범위

Superpower Inside는 데스크톱 Obsidian 안에서 노트·PDF를 근거로 묻고, 자료를 비교하고, 출처를 확인하며 글을 작성하도록 돕는 무료·오픈소스 플러그인이다. 볼트 정보를 정확히 제공하는 역할과 일반 챗봇·명시적으로 연결한 외부 MCP 도구의 역할을 함께 유지한다. 검색 개선을 이유로 다른 역할을 축소하지 않는다.

현재 제품은 볼트 색인·검색, 근거 연결 채팅, 여러 모델 제공자 연결, 외부 도구 연결과 대화 저장을 제공한다. 모든 Obsidian 기능 활용이나 아래 품질 하한의 달성을 현재 지원 완료로 선언하는 것은 아니다.

## 고객 가치와 품질

`product-philosophy`는 최소 관여·보이지 않는 조율·결과 중심의 주의·사용 만족과 충실도의 책임을 소유한다. `search-quality`는 Ctrl+F 전수검색을 발견과 답변 내용의 하한으로 삼는 기준·모델별 대조·검색 엔진 지연의 보조 목표를, `vault-evidence`는 현재 원문·인용·조사 실패의 구체 계약을 소유한다. 대기 경험은 `interface-design`을 따른다. 이 문서에 같은 수치·절차를 중복 정의하지 않는다.

## 범위·검증 경계

플러그인의 접근·제외 설정 밖 자료를 검색 가능한 세계에 포함하지 않는다. 검색 비활성 대화, 볼트 근거, 외부 MCP 근거를 구분한다. 사용자가 선택한 모델·추론·연결을 품질 개선 명목으로 임의 교체하지 않는다.

비공개 볼트와 평가 원문·질의·정답은 공유 명세·fixture에 복제하지 않는다. 공개 코퍼스 평가에서도 검색 대상 자료와 평가 코드·질의·정답·보고서를 분리한다. Git 제외와 검색 제외는 서로 다른 경계다. 검증 절차·격리 계약은 [engineering-contract.md](engineering-contract.md#테스트-볼트와-평가-데이터)를 따른다.

## 근거와 달성 상태

이 초안은 pi·Codex 기억의 지속적인 결정을 기존 작업 계약·구현과 대조해 시작했고, 저장소 사람용 문서의 정본 이전으로 확장했다. 문서별 소유권과 근거/이력의 경계는 [documentation-contract.md](documentation-contract.md)가 정한다. 개인 환경·계정·과거 실행 권한은 편입하지 않는다. 기억 원본은 보존하며 이 문서는 원본 전체의 대체물이 아니다.

검색 품질 요구는 현재 구현의 합격 증명이 아니다. 실제 답변·Ctrl+F 대조와 모델별 반복 검증의 미완료 상태와 종료 판정은 [검색 품질 스펙](search-quality.md)의 검증 상태 절이 소유한다. 구체적 구현 차이는 소유 모듈 명세에 기록한다. 모든 새 노드는 사용자 내용 검토 전까지 draft다.
