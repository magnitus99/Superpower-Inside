---
id: artifact-storage
type: module-design
status: draft
title: 생성물 소유권과 정리 경계
parent: superpower-architecture
---

# 생성물 소유권과 정리 경계

## 책임과 의도

플러그인이 만든 파일·IndexedDB의 기능 소유권·형식 세대·활성 사용을 기록하고, 지원이 끝난 생성물만 정리 대상으로 계획한다. 임의의 파일명·DB 이름 유사성만으로 사용자 자료를 폐기하지 않는 것이 경계다. 사용자 노트·대화·설정·키와 재생성 가능한 색인·캐시를 구분한다.

등록부에는 소유권 식별자와 세대만 저장하고 내용·키 원문은 넣지 않는다. 열려 있는 DB와 진행 중인 파일 사용은 lease로 보호한다. 파일 adapter는 플러그인 전용 경계를 감싸며 vault 전역 I/O를 가로채지 않는다.

## 승인·동시성 경계

폐기는 서비스가 발급한 snapshot을 대상으로 하며 실행 시 현재 revision·활성 여부·소유권을 다시 확인한다. 오래된 측정 결과가 현재 실행의 삭제 권한이 되지 않는다. 정리 계획의 계산과 실제 I/O를 분리하고, 측정·계획·실제 삭제 성공을 같은 상태로 표현하지 않는다.

## 구현·검증 근거

`generated-artifacts.ts`의 `GeneratedArtifactRegistry`·`GeneratedArtifactDatabase`, `retired-artifacts.ts`의 `RetiredArtifactService`가 근거다. 관련 회귀 근거는 `generated-artifacts.test.ts`, `retired-artifacts.test.ts`, `artifact-boundary.test.ts`다. 실제 파일·DB의 삭제나 사용자 데이터 보존 실험은 이번 문서 편입에서 실행하지 않았다.
