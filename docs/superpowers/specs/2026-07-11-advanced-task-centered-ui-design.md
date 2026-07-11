# Advanced 작업 중심 설정 UI 설계

## 결정

Advanced 탭의 유일한 기능인 플러그인 인식 생성을 공통 settings workspace와 section, status row, notice, setting row로 표현한다. 기존 toggle, 저장, Context7 경고 판정, 기능 한계 문구는 유지한다.

## 정보 구조

1. 현재 활성/비활성 상태와 효과를 status row로 보여준다.
2. Context7 서버가 필요한 상태면 공통 warning notice를 상태 가까이에 표시한다.
3. 기능 toggle을 평평한 설정 행으로 제공한다.
4. 이 기능이 모든 플러그인 API를 보장하지 않는다는 한계를 info notice로 표시한다.

기존 패널 외형만 바꾸거나 별도 마법사를 만드는 방식은 각각 정보 위계가 부족하거나 범위가 과하므로 사용하지 않는다. 설정 스키마, prompt 생성 로직, MCP 서버 설정은 변경하지 않는다.

## 테스트와 검수

- Advanced가 공통 workspace, section, status row, notice를 사용하는지 고정한다.
- 기존 `createSettingsPanel`, help/warning 전용 표면을 제거한다.
- toggle callback과 Context7 warning 판정을 유지한다.
- 전체 품질 게이트 후 실제 Obsidian에서 on/off, warning 유무, light/dark, 좁은 폭을 스크린샷 검수한다.

## 완료 조건

Advanced가 다른 설정 탭과 같은 정보 위계와 표면 언어를 사용하고, 기존 기능 동작과 한계 설명에 회귀가 없으며 전체 자동·비주얼 검증을 통과한다.
