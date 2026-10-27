---
id: provider-boundary
type: module-design
status: draft
title: 모델 제공자와 자격증명 경계
parent: superpower-architecture
---

# 모델 제공자와 자격증명 경계

## 책임

제공자별 인증·메시지·스트림·도구 호출·임베딩 입출력을 공통 계약에 연결한다. 기본 메시지·ChatOptions 계약은 `providers.ts`가 소유한다. 제공자의 유창함이나 호출 성공이 볼트 출처의 자격 또는 답변 충실도를 증명하지 않는다.

사용자가 선택한 제공자·모델·추론 설정을 유지한다. 요청 실패나 근거 부족을 이유로 다른 모델·유료 경로로 조용히 전환하지 않는다. 재시도·기능 지원·buffered 응답·실제 abort 가능성은 제공자별로 구분하며 best-effort 취소를 원격 실행 중단 보장으로 표현하지 않는다.

## 보안 저장 경계

API 키와 ChatGPT 자격증명의 영속화는 Obsidian SecretStorage에 한정한다. `src/secrets/provider-secrets.ts`는 런타임에서 사용 가능한 키와 저장용 설정 사본을 분리하고, 사본의 키 원문을 제거한다. `main.ts`의 `saveSettings`가 보안 저장과 설정 저장 순서를 조립한다. 키가 다른 장치에 없다는 상태와 사용자가 키를 설정하지 않은 상태를 구분한다.

일반 설정·data.json·localStorage·로그·공유 명세에 키·토큰·쿠키 원문을 기록하지 않는다. 기존 인증 자료를 문서 import 과정에서 복제하거나 정상 로그인 대신 과거 바이트로 복원하지 않는다.

## 근거와 한계

공통 계약은 `providers.ts`, 비밀정보 처리는 `src/secrets/provider-secrets.ts`와 `provider-secrets.test.ts`가 근거다. 제공자별 메시지·스트리밍·tool call 테스트는 로컬 계약 검증이며 실제 온라인 제공자 지원·로그인 성공을 대신하지 않는다. 이번 편입에서는 인증·설정·제공자 구현을 변경하거나 온라인 호출을 실행하지 않았다.
