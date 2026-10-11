# Windows에서 벤치마크·마케팅 작업 이어가기

이 문서는 사용자가 요청한 **작업 중단과 Windows 새 클론 이전**을 위한 인계서입니다. 작성 기준일은 2026-10-11, 브랜치는 `codex/public-vault-benchmarks`, 하네스 보강 커밋은 `5245def41463a74af256473e86211505c0c4f7b7`, 제품 버전은 `3.0.0`입니다. 인계서까지 포함한 최종 버전은 원격 브랜치 HEAD에서 확인합니다. 기존 `AGENTS.md`가 작업 규칙의 기준이며, 이 문서는 작업의 목적·현재 상태·이전 절차를 설명합니다.

**가장 중요한 상태:** 전체 벤치마크는 완료되지 않았고, 공개할 제품 성능 수치도 아직 없습니다. macOS 실행은 중단했고 자동 후속 작업은 일시 중지했습니다. Windows 준비와 명시적인 재개 전에는 평가를 다시 시작하지 않습니다.

## 1. 이 브랜치를 만든 이유와 최종 목표

사용자의 목적은 **Superpower Inside가 흩어진 문서에서 필요한 근거를 찾고, 그 근거를 최종 답변에 반영하는 능력을 수치로 입증해 다운로드할 이유를 만드는 것**입니다. 특히 다른 제품보다 근거를 잘 찾는다는 강점을 뒷받침할 수 있는 마케팅 자료를 원했습니다.

평가 체계 자체를 홍보하는 것이 최종 목표는 아닙니다. README와 제품 소개에서 독자가 “이건 다운로드할 가치가 있다”고 판단할 만한 실제 결과가 필요합니다. 따라서 구현·실행·독립 판정·조건을 맞춘 공개 수치 비교·사용자 관점의 소개까지 연결되어야 합니다. 기대한 우위가 결과에 나타나지 않으면 실패 원인을 구분하고 제품이나 평가의 실제 문제를 개선해야 합니다. 원하는 결론에 맞춰 점수를 만드는 것은 목표가 아닙니다.

최신 합의에 따른 평가 대상은 **Superpower Inside 한 제품 전체**입니다. 실제 Obsidian의 채팅, 문서 청킹, 임베딩, BM25, 하이브리드 검색, 컨텍스트 구성, 필요한 볼트 도구, 최종 답변과 출처를 함께 실행합니다. 모든 질문에 모든 기능을 억지로 호출하는 것은 아니며 실제 제품의 경로 선택을 따릅니다.

경쟁 제품은 **그들이 이미 발표한 공개 벤치마크 수치와 조건을 조사·대조**합니다. 경쟁 플러그인을 설치하고 직접 비교 평가하는 계획은 사용자가 과도하다고 판단해 제외했습니다. 동일 벤치마크라는 이유만으로 동일 조건인 것은 아닙니다. 모델·코퍼스·질문·채점·정답 보정 조건이 다르면 우위를 주장할 수 없습니다.

최종 산출물은 다음과 같습니다.

1. 실제 제품으로 완료한 WixQA와 EnterpriseRAG-Bench 전체 평가, 독립 판정, 재현 조건, 실패를 포함한 집계.
2. 답변 정확성·완전성·인용의 실제 지지·필수 문서 확보를 설명할 수 있는 결과와 한계.
3. 비교 가능한 외부 수치와 직접 비교할 수 없는 수치의 구분.
4. 검증된 수치만 반영한 한·영 README 소개, `marketing/benchmarks.md`의 결과·조건·비교표, 적절한 성공·실패 사례와 화면 근거.
5. 필요한 회귀 테스트와 변경 범위의 품질 검사, 데이터가 빠진 영어 논리 단위 커밋.

## 2. 사용자가 지정한 활성 채팅 5개

아래 5개를 실제 `read_thread`로 다시 읽었습니다. 보관된 다른 채팅의 작업은 인계 범위에 포함하지 않습니다. 초기 계획보다 이후의 사용자 정정이 우선합니다.

### 2.1 벤치마크 데이터셋 조사

- 채팅: `01a11e79-8a16-7cb2-ae97-d3b837e166e6`
- 요청: 제품의 역할을 먼저 정의하고 비슷한 제품의 홍보 지표·데이터셋·모델을 조사. 실제 문서와 QA로 평가하고, 선택한 모델에 플러그인이 더하는 근거 활용 가치를 측정. 데이터에 MIT가 명시되고 별도 허가가 필요 없는 자료로 제한. Ponytail ultra 적용.
- 실행: EnterpriseRAG-Bench와 WixQA 다운로드·변환·라이선스/출처/해시 기록. 검색 평가와 각 12문항의 예비 모델 평가. 원문·결과는 `.test-vault/.benchmarks/`에 격리.
- 브랜치/커밋: 사용자가 적당한 브랜치 이름과 영어 커밋을 요청했고 **데이터 종류만 포함하고 데이터 자체는 제외**하라고 명시. `codex/public-vault-benchmarks`, `83cf72c`, `ffbc4ba` 생성. 푸시하지 않음.
- 한계: 당시 BM25와 반복 검색의 비교는 구성요소 실험이었고 최신 제품 전체의 성적이 아님.

### 2.2 테스트 루프 개선

- 채팅: `01a1255d-47b3-7a51-b1d5-c6f7ba46d4f6`
- 요청: main과 비교해 테스트 루프를 개선하고 실제 다운로드한 데이터셋으로 평가. `rnr`은 **역할과 책임(R&R)**으로, 플러그인의 근거 검색·전달과 모델의 해석·답변 생성 병목을 구분하라는 뜻.
- 정정: 사용자가 “RAG + 도구 루프 + BM25를 다 같이 사용”, 문항 수 확대, 완료 후 영어 커밋을 명시.
- 실행: 실패 분모·조건 지문·재개 검증·질문 단위 신뢰구간·원문 확인/모델 전달/최종 답변 관측을 보강. 실제 예비 평가를 재실행. 하이브리드 기본 평가와 임베딩 연결을 추가하고 `fc2af89` 커밋.
- 한계: 당시 Enterprise 기본 499문항은 모호한 ID 제외 설계였음. **현재 네이티브 평가에서는 원문을 보존해 핵심 500문항으로 변경됨.** 확대된 전체 모델 평가는 그 채팅에서 실행하지 않음.

### 2.3 현재 결과물의 마케팅 활용 조사

- 채팅: `01a12877-51be-7d40-a8bf-eac4bbf0a0be`
- 요청: 결과를 README·제품 페이지에서 활용. 이후 “평가가 투명하다”는 소개보다 **타 제품보다 근거를 찾는 능력을 입증하는 것이 브랜치를 만든 이유**라고 정정.
- 정정: BM25를 별도 제품처럼 평가하는 데 동의하지 않았고 “Superpower Inside는 하나”라고 명시. 경쟁 제품 설치·직접 실행 대신 그들이 발표한 수치와 측정 조건을 비교하는 방향으로 확정.
- 실행: 실제 Obsidian `ChatView`/`handleSend`를 이용하는 네이티브 제품 평가, 공개 코퍼스 폴더 범위, 독립 DB·캐시, 실제 출처 카드의 줄 구간 판정, Enterprise 공식 채점 경로를 도입. `marketing/benchmarks.md`와 README 링크 추가. 정상 문서의 임베딩 결과를 폐기하던 색인 버그 수정. 이 변경은 `8c99f9a`에 포함됨.
- 한계: 25문서·6문항 등 연결 검증만 완료. 경쟁 우위·전체 제품 성능·전체 코퍼스 완료의 증거는 없음.

### 2.4 마케팅 벤치마크 파이프라인 점검

- 채팅: `01a128c8-8307-77f1-9baa-944b25448f81`
- 요청: 마케팅을 우선해 다운로드를 유도할 근거와 수치를 만들고 전체 파이프라인을 개선. 처음에는 읽기·인터넷 조사만 요청했지만 이후 “오케이 진행해줘…고고!”로 구현과 실행을 승인.
- 실행: 생성 모델과 다른 판정 모델, 공개 주장 게이트, 리더보드 CSV 스냅샷/해시, 색인 준비·전체 소요 시간, 인용 지지·정보 없음 대응 집계, 일반 RAG 이벤트 억제/복구를 추가. 33개 관련 테스트와 독립 판정 1문항 스모크를 통과.
- 중단 상태: 이전 Wix 전체 실행이 675/6,221문서 준비에서 종료. macOS `setsid` 부재 등 실행 유지 문제가 있었고 전체 답변/요약이 없음. Enterprise 전체와 최종 마케팅 자료도 미완료. 당시 보강 변경은 미커밋.

### 2.5 @마케팅 벤치마크 파이프라인 점검 여기서 하던거 마저 다 해줘. @Ponytail 이거 적용하는거 잊지 말…

- 채팅: `01a1293a-8ae4-7163-8efd-4ac8fd15bcb4`
- 요청: 앞 채팅의 남은 작업을 모두 완료하고 Ponytail 적용을 유지.
- 실행: 앞 채팅·메모리·저장소·로그를 확인하다 중단됨. 새 전체 평가 완료나 최종 결과는 없음.

### 2.6 현재 인계 채팅에서 추가한 작업과 최신 지시

- 현재 채팅: `01a1295c-9c58-76a0-9110-0930d91a7a40`.
- 모델 ID까지 비교하는 독립 판정 검증, 질문·반복 구성 검증, 공통 재개 검증 재사용, 평가 창의 백그라운드 타이머 제한 일시 해제/복구, 문서 하나씩 가져오기를 보강.
- `--judge-model` 옵션 전달과 검증을 추가하고 합성 회귀 테스트를 확장. 관련 테스트 37개, `quality:local` 1,571개 통과·1개 제외, 오프라인 채팅 계약 184/184 통과(종료 코드 0).
- 실제 3문항 연결 검증은 오류 0, 추가 질문 1, 정답 판정 1, 근거까지 충족한 성공 0. **품질 향상이나 공개 성적의 근거가 아님.**
- 사용자가 자동 후속 작업을 승인해 Wix → Enterprise 큐와 시간당 heartbeat를 설정. 이후 범위를 위 활성 5개로 정정했고, 요약보다 실제 남은 작업 완료를 요구.
- **최신 지시는 모든 실행 중단 및 Windows 새 클론을 위한 이 인계서 작성.** 따라서 이전의 자동 실행 승인으로 지금 다시 평가를 시작하지 않음.
- 이후 사용자가 인계 작업 완료 후 **영어 커밋과 브랜치 푸시**, 커밋에 따른 변경을 이 문서에 반영하도록 요청. 하네스 보강을 `5245def`로 커밋하고, 설명·인계서를 별도 문서 커밋으로 전달. 전체 평가나 자동화를 재개하는 요청은 아님.

## 3. 중단 시점의 실제 상태

2026-10-11 17:11 KST 기준입니다.

| 항목               | 확인한 상태                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 큐                 | `session-completion-oct11-v2`, 사용자 요청으로 중단                                                              |
| 프로세스           | 큐 Node PID 89315, caffeinate PID 89316 종료 확인                                                                |
| 자동화             | `superpower-inside`, `PAUSED`; Windows로 자동 이전되지 않음                                                      |
| Wix 준비           | 마지막 진행 로그 3,050/6,221; 종료 후 실제 남아 있던 공개 파일 3,058개 확인                                      |
| Wix 본 평가        | 답변 행 0; `specification.json`만 존재; `summary.json` 없음                                                      |
| Enterprise 본 평가 | 아직 시작하지 않음                                                                                               |
| 파일 정리          | 3,058개 파일 모두 다운로드 코퍼스의 허용 경로·SHA-256과 대조 후 제거; 임시 공개 폴더 제거; 잔존 공개 파일 0      |
| 앱/DB 정리         | Obsidian CLI가 실행 중 앱을 찾지 못함. 네이티브 `cleaned`/`cleanup.json`과 평가용 IndexedDB 정리는 확인하지 못함 |
| 보존               | 기존 노트·설정·키·세션·원본 데이터·기존 인덱스는 삭제하지 않음                                                   |
| Git 전달           | 아래 하네스 보강·평가 설명·인계서를 영어 커밋으로 정리해 같은 원격 브랜치로 전달                                 |

앱이 종료된 상태여서 자동 `finally` 정리가 완료됐다고 주장하지 않습니다. 남은 `native-work`는 진단용으로 보존했습니다. Windows에는 macOS Obsidian 프로필/IndexedDB/해당 임시 작업 폴더를 옮기지 않습니다. macOS에서 나중에 정리할 때도 앱 전체 DB를 지우지 말고 **해당 평가가 만든 독립 DB만** 식별해 정리해야 합니다. 앱 재시작 시 일반 이벤트와 창 타이머 정책도 확인합니다.

중단 기록은 로컬 `.test-vault/.benchmarks/session-completion/user-stop.json`과 `status.json`에 있습니다. PID와 절대 경로는 새 컴퓨터의 재개 자료가 아닙니다.

## 4. Git에 있는 것, 없는 것, 이전할 것

### 4.1 이미 로컬 Git 커밋에 있는 것

| 커밋      | 의미                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `83cf72c` | 평가 런타임 컴파일러 재사용과 직접 실행 진입점 정리                                                                         |
| `ffbc4ba` | MIT 공개 데이터셋 다운로드·검색·답변 평가 하네스와 합성 테스트                                                              |
| `fc2af89` | 하이브리드 RAG·BM25·도구 흐름 평가, 확대 문항·반복·재개                                                                     |
| `8c99f9a` | 실제 Obsidian 제품 평가/공식 Enterprise 채점/비교 문서/README 링크/색인 버그 수정. 커밋 제목은 `.`이므로 변경 내용으로 식별 |
| `5245def` | 독립 판정·공개 게이트·호스트 정책 복구·재개 검증·외부 스냅샷·시간 지표·CLI 옵션 전달과 합성 회귀 테스트                     |

`main.js`, Rust/WASM glue와 포함된 WASM 바이트, `tern_engine_bg.wasm`, EmbeddingGemma 실행 자산도 현재 Git 추적 대상입니다. **`.gitignore`에 `main.js`가 있어도 기존 추적 파일은 clone에 포함됩니다.** 소스 변경 후 번들이 최신인지 별도로 확인해야 합니다.

### 4.2 이번 인계에서 커밋해 전달하는 변경

| 파일                                        | 인계 변경의 목적                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `scripts/chat-tool-evaluation.mjs`          | 판정 요청에 별도 모델 참조 사용                                                    |
| `scripts/native-product-benchmark.mjs`      | 독립 판정·공개 게이트·외부 스냅샷·시간/인용/유보 지표·호스트 복구·재개·문서별 준비 |
| `scripts/native-product-benchmark.test.mjs` | 위 동작의 합성 회귀 테스트                                                         |
| `scripts/public-vault-benchmark.mjs`        | 독립 판정 bridge와 CLI 옵션 전달                                                   |
| `scripts/public-vault-benchmark.test.mjs`   | 판정 모델 옵션 및 전달 계약 테스트                                                 |
| `marketing/benchmarks.md`                   | 평가 계약, 공개 게이트, 외부 수치·조건, 재현 설명                                  |
| `BENCHMARK_MARKETING_CONTINUE_GUIDE.md`     | 이 인계서(새 파일)                                                                 |

위 변경은 모두 이번 인계의 Git 커밋에 포함합니다. **최신 원격 브랜치 clone으로 코드·평가 설명·인계서를 함께 가져오며 미커밋 패치는 필요하지 않습니다.** 데이터·인증·볼트는 아래와 같이 별도로 복원합니다.

### 4.3 Git에서 제외하며 새 clone에 없는 것

| 항목                                | Windows에서 처리할 방법                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `.test-vault/` 전체                 | 전용 평가 볼트를 새로 만듦. 개인 노트 전체 복사 불필요                                     |
| `.test-vault/.benchmarks/datasets/` | 공개 데이터 재다운로드/변환 또는 이 디렉터리만 별도 비공개 전송                            |
| `.benchmarks/runs/`, `native-runs/` | 과거 진단 기록. 필요하면 별도 보관; Windows 새 실행에 점수/행을 합치지 않음                |
| `native-work/`, queue/PID/stop 파일 | 실행 중 상태이므로 복사·실행하지 않음                                                      |
| `data.json`, OAuth 저장소, 키·토큰  | Git/패치/문서에 넣지 않음. Windows에서 재인증하고 설정을 재구성                            |
| Obsidian IndexedDB·임베딩 캐시      | OS 간 그대로 이전하지 않음. Windows에서 독립 인덱스 생성                                   |
| `embeddinggemma-300m/`              | 모델 파일은 제외됨. 플러그인에서 같은 모델을 다시 다운로드/검증                            |
| `node_modules/`, `target/`          | OS별로 새로 설치/빌드. macOS 바이너리 복사 금지                                            |
| 스크린샷·임시 결과                  | 필요하면 별도 보관. 개인 볼트 식별 정보를 공개하지 않음                                    |
| Codex 채팅·메모리·스킬·자동화       | 저장소 clone에 포함되지 않음. 이 문서가 맥락을 전달하며 Ponytail은 새 환경에서 별도 활성화 |

MIT 저작권·라이선스 고지와 Wix.com AI Research 출처는 유지합니다. 공개 데이터라도 이 작업에서는 원문·QA·결과를 Git에 올리지 않는 사용자 지시를 따릅니다. 테스트는 볼트와 무관한 합성 데이터로 유지합니다.

## 5. 새 clone에 현재 브랜치를 가져오는 방법

원격은 `git@github.com:magnitus99/Superpower-Inside.git`입니다. 처음 인계서를 작성할 때는 원격 브랜치가 없었지만, 이후 사용자가 **영어 커밋과 브랜치 푸시**를 명시적으로 요청했습니다. 코드 보강과 이 문서를 커밋해 `origin/codex/public-vault-benchmarks`로 전달합니다. 전체 벤치마크·자동화는 계속 중단 상태이며, 커밋·푸시는 실행 재개가 아닙니다.

### 권장: 원격 브랜치를 바로 clone

이 방법으로 하네스 보강과 인계서까지 가져옵니다. 이전에 제공한 미커밋 패치를 적용할 필요가 없습니다. PowerShell에서 자신의 경로로 바꿔 실행합니다. 외부 명령 실패 시 다음 명령을 계속 실행하지 않습니다.

```powershell
$repoDir = 'D:\Work\Superpower-Inside'
git clone --branch codex/public-vault-benchmarks https://github.com/magnitus99/Superpower-Inside.git $repoDir
if ($LASTEXITCODE -ne 0) { throw 'clone 실패' }
Set-Location $repoDir

git branch --show-current
git merge-base --is-ancestor 5245def41463a74af256473e86211505c0c4f7b7 HEAD
if ($LASTEXITCODE -ne 0) { throw '하네스 보강 커밋 누락' }
if (-not (Test-Path 'BENCHMARK_MARKETING_CONTINUE_GUIDE.md')) { throw '인계서 누락' }
git log -3 --oneline
git status --short --branch
```

clone 직후 tracked 변경이 없는 상태가 정상입니다. 인계서 자체의 최종 커밋 ID는 `git log -1 -- BENCHMARK_MARKETING_CONTINUE_GUIDE.md`로 확인합니다. `5245def...`는 하네스 보강 커밋이므로 최종 HEAD가 이 값과 같아야 하는 것은 아닙니다.

### 오프라인 대안: 최신 커밋을 담은 bundle

이전 묶음은 macOS의 `.test-vault/.benchmarks/windows-handoff/`에 있습니다. 커밋 후 최신 브랜치로 bundle·인계서 복사본·manifest·ZIP을 갱신합니다.

- `public-vault-benchmarks.bundle`: 인계서까지 커밋한 브랜치와 그 이력. 무시된 데이터·키는 포함하지 않음.
- `BENCHMARK_MARKETING_CONTINUE_GUIDE.md`: 먼저 읽기 위한 최신 인계서 복사본.
- `handoff-manifest.json`: 최종 커밋 ID와 전달 파일 SHA-256.
- `windows-handoff.zip`: 위 파일들의 전달용 묶음.

**이전 버전의 `working-tree.patch`는 사용하지 않습니다.** 해당 변경은 이미 커밋됐으므로 패치를 추가 적용하면 중복·충돌이 납니다. 최신 이전 묶음에서 오래된 패치는 제거합니다. 기존 다운로드한 ZIP이 오래된 것이라면 원격 clone을 사용하거나 최신 묶음으로 다시 전달합니다.

bundle을 사용하는 경우 먼저 별도 전송 폴더에서 manifest 해시를 검증합니다. 새 원격 clone에 브랜치가 이미 있다면 bundle을 추가로 덮어쓸 필요가 없습니다. 원격 접근 없이 새 저장소를 만드는 경우:

```powershell
$handoffDir = 'D:\Transfer\windows-handoff'
$repoDir = 'D:\Work\Superpower-Inside'
$manifest = Get-Content (Join-Path $handoffDir 'handoff-manifest.json') -Raw | ConvertFrom-Json
foreach ($item in $manifest.files) {
    $actual = (Get-FileHash (Join-Path $handoffDir $item.name) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $item.sha256) { throw "전송 파일 해시 불일치: $($item.name)" }
}
$bundle = Join-Path $handoffDir 'public-vault-benchmarks.bundle'
git clone --branch codex/public-vault-benchmarks $bundle $repoDir
if ($LASTEXITCODE -ne 0) { throw 'bundle clone 실패' }
Set-Location $repoDir
if ((git rev-parse HEAD).Trim() -ne $manifest.baseCommit) { throw '최종 커밋 불일치' }
git remote set-url origin https://github.com/magnitus99/Superpower-Inside.git
git status --short --branch
```

배포 자산·개인 설정·데이터 복원은 다음 절차를 따릅니다. 브랜치 푸시는 사용자 요청 범위에 포함되지만 main merge·force push·태그·릴리스는 이번 이전 범위가 아닙니다.

## 6. Windows 준비: 지금 바로 전체 평가를 실행하면 안 되는 이유

**현재 스크립트는 Windows 전체 실행을 검증하지 않았습니다.** 아래 호환성 작업을 먼저 끝내야 합니다. 이 인계 작업에서는 런타임이나 빌드를 변경하지 않습니다.

| 경계            | 현재 구현과 필요한 작업                                                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 네이티브 CLI    | `native-product-benchmark.mjs`가 `/Applications/Obsidian.app/Contents/MacOS/obsidian-cli`를 하드코딩. Windows `Obsidian.com` 및 명시적 전용 볼트 선택을 지원하도록 최소 수정·합성 테스트 필요 |
| 볼트 경로       | provider bridge가 `<저장소>/.test-vault`와 Obsidian 실제 base path의 정확한 일치를 요구. 다른 볼트/대소문자/경로 표현으로 우회하지 말고 정상 경로 정규화 여부를 검증                          |
| Enterprise 압축 | `prepareEnterprise`가 `unzip -Z1`, `unzip -n -q ... '*.txt' -d ...`를 실행. Git for Windows 등에 있는 호환 unzip을 PATH에서 확인하거나 검증된 최소 대안을 구현. zip 경로 검증을 유지          |
| Fish 빌드       | `npm run build`는 Fish 스크립트 사용. `run-fish.mjs`는 Windows에서 WSL fish로 연결. WSL의 Rust·Node·명령 준비와 Windows 의존성의 실행 파일 형식이 모두 맞는지 확인해야 함                     |
| 품질 runner     | `check-quality.mjs`가 `spawnSync('npm', ...)` 사용. Windows의 npm.cmd 호출 차이를 검사하고 필요하면 테스트와 함께 이식. 실패한 runner를 통과했다고 기록하지 않음                              |
| 사용자 설정     | `profile-3`는 로컬 프로필 ID이며 clone으로 재생성되지 않음. 모델 참조가 실제 Windows 설정과 일치해야 함                                                                                       |
| 장시간 유지     | macOS `caffeinate`, `setsid`, 기존 queue/PID를 복사해 쓰지 않음. Windows에서 절전·앱 종료·한도·취소와 로그 유지 방식을 준비                                                                   |

### 6.1 도구와 의존성

Git for Windows, Windows Node.js/npm, Obsidian 데스크톱과 CLI를 설치합니다. CI는 Node 22, 이번 macOS 실행은 Node 24.21.0을 사용했습니다. 새 환경의 Node·OS·Obsidian 버전은 실행 기록에 남깁니다. 우선 잠금파일대로 설치합니다.

```powershell
node --version
npm --version
git --version
npm ci
if ($LASTEXITCODE -ne 0) { throw '의존성 설치 실패' }
npm run hooks:install
if ($LASTEXITCODE -ne 0) { throw '훅 설치 실패' }
```

기존 훅 충돌은 통합해 해결하고 검사를 제거하는 방법으로 우회하지 않습니다. Python, 새 평가 프레임워크, 유료 API를 추가할 필요는 없습니다.

### 6.2 빌드 환경 선택

Rust/WASM 소스를 바꾸지 않은 현재 인계 상태에서는 추적된 WASM glue·바이트와 실행 자산을 사용할 수 있습니다. Windows 최초 연결 확인용으로 아래 Node 빌드를 사용할 수 있으나, **정식 `npm run build` 전체 검증이나 Rust 재빌드를 통과한 것으로 부르지 않습니다.** 생성물이 달라지면 변경 원인을 확인합니다.

```powershell
node scripts/build-workers.mjs
if ($LASTEXITCODE -ne 0) { throw 'worker 생성 실패' }
node esbuild.config.mjs production
if ($LASTEXITCODE -ne 0) { throw '플러그인 번들 실패' }
git diff --stat
```

Rust/WASM 변경이나 정식 전체 빌드가 필요하면 `rust-toolchain.toml`의 Rust `1.96.0`, `wasm32-unknown-unknown`, clippy/rustfmt와 `wasm-bindgen-cli 0.2.123`을 준비합니다. Windows의 WSL Fish 빌드 경로는 다음 원칙을 따릅니다.

- Windows 저장소·볼트는 Windows Obsidian과 Node가 접근 가능한 같은 NTFS 경로에 둡니다.
- WSL에서는 fish와 Linux용 Rust/Node/build 도구를 별도로 준비합니다. Windows `node_modules/.bin` shim이 Linux 도구처럼 실행된다고 가정하지 않습니다.
- 별도 WSL checkout에서 잠금파일대로 Linux 의존성을 설치해 `npm run build`를 수행하고 생성 자산만 검증해 전달하는 방법도 가능하지만, checkout의 커밋과 추가 작업 파일이 완전히 같아야 합니다. 플랫폼별 `node_modules`를 섞지 않습니다.
- generated glue/base64를 손으로 고치거나 WASM 실패를 TS 대체 계산으로 숨기지 않습니다.

### 6.3 전용 Obsidian 볼트와 CLI

저장소 바로 아래 `.test-vault`를 새 평가 전용 볼트로 만듭니다. 저장소 전체나 개인 볼트를 평가 볼트로 열지 않습니다. 플러그인 파일은 `.test-vault/.obsidian/plugins/superpower-inside/`에 설치합니다.

```powershell
$pluginDir = Join-Path $repoDir '.test-vault\.obsidian\plugins\superpower-inside'
New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
$assets = @('main.js', 'manifest.json', 'styles.css', 'tern_engine_bg.wasm',
    'embeddinggemma-worker.js', 'embeddinggemma-runtime.mjs', 'embeddinggemma-runtime.wasm')
foreach ($asset in $assets) {
    Copy-Item (Join-Path $repoDir $asset) (Join-Path $pluginDir $asset)
}
```

Obsidian에서 `.test-vault`를 볼트로 등록하고 이 플러그인을 활성화합니다. CLI를 설정에서 등록한 후 PowerShell을 새로 열어 `Get-Command obsidian`과 `obsidian help`를 확인합니다. Windows는 앱의 `Obsidian.exe` 대신 터미널 redirector `Obsidian.com`을 사용하는 것이 공식 방식이며 앱이 실행 중이어야 합니다. [Obsidian 공식 CLI 문서](https://obsidian.md/help/cli)

이식한 하네스는 이 전용 볼트를 명시적으로 지정해야 합니다. 기본 활성 창에 의존하지 않습니다. CLI 경로가 정상인지 확인한 뒤 합성 테스트로 Windows 명령/인수 전달을 검증하고 실제 소규모 연결 테스트를 수행합니다. Obsidian 네이티브 마우스·타이핑 자동화는 사용하지 않습니다.

### 6.4 생성·임베딩·판정 설정

| 역할   | macOS에서 사용한 참조                   | 유지할 모델         |
| ------ | --------------------------------------- | ------------------- |
| 생성   | `profile:profile-3:gpt-6.1-sol`         | GPT-6.1 Sol         |
| 임베딩 | `profile:ternlight:embeddinggemma-300m` | EmbeddingGemma 300M |
| 판정   | `profile:profile-3:gpt-6-luna`          | GPT-6 Luna          |

Windows에서 같은 계정·provider·모델을 재설정하고 재인증합니다. 프로필 ID가 달라졌다면 실제 ID로 참조를 바꾸되 **모델 변경으로 취급하지 않는 단순 ID 매핑임을 기록**합니다. 생성 모델/추론 강도는 사용자의 선택을 유지합니다. 생성과 같은 모델을 다른 프로필로 연결해도 독립 판정자가 아닙니다.

중단된 실행의 `specification.json`에서 확인한 값은 `chunkSize: 1000`, `overlap: 100`, `minScore: 0.3`, `bm25Weight: 0.3`입니다. 청킹·검색 설정은 이 값과 대조하고, 도구/기본 프롬프트·추론 설정도 확인해 고정합니다. 원래 실행의 `specification.json`은 비밀 없는 선택된 설정/지문 기록을 포함하지만 전체 인증 설정의 백업은 아닙니다. 값을 모르면 임의 조정한 뒤 “같은 조건”이라고 소개하지 않습니다. 설정 전체나 `data.json`을 채팅에 출력하지 않습니다.

EmbeddingGemma 모델은 새로 다운로드하고 실제 임베딩을 확인합니다. 고사양 GPU가 있어도 실제 backend가 WebGPU인지 WASM인지 로그로 검증해야 합니다. 이번 제품에는 backend fallback이 존재하므로 GPU 사용을 가정해 속도를 홍보하지 않습니다.

## 7. 데이터셋 복원

| 데이터                     | 고정할 범위                         | 본 평가                                                    |
| -------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| WixQA                      | 문서 6,221개                        | expert 200 + simulated 200 = 400문항, 질문당 3회 = 1,200회 |
| EnterpriseRAG-Bench v1.0.0 | 문서 511,962개, 같은 ID 원문도 보존 | 핵심 500문항, 질문당 3회 = 1,500회                         |

Wix synthetic 6,221문항은 본 답변 지표에 섞지 않습니다. 별도 검색 진단이며 답변 정확도로 바꾸지 않습니다. Enterprise metadata 추가 100문항도 기본 공식 500문항에 섞지 않습니다. 원문 크기만 보고 “50만 문서 평가 완료”라고 하지 않습니다.

데이터 종류·다운로드 주소는 코드에 있지만 원문은 Git에 없습니다. 원래 Wix revision은 `d662dc42479c14e202eccd832f8c4b66a035c4cc`, Enterprise 배포는 `v1.0.0`입니다. 현재 다운로드 명령은 Wix 최신 revision을 조회하므로 재다운로드 시 revision/해시가 달라질 수 있습니다. 원래 조건을 정확히 복원하려면 기존 `datasets/`만 별도 전송하거나 다운로드를 기록된 revision으로 고정하는 최소 변경을 검증합니다. 달라지면 새 실행 조건으로 기록합니다.

Windows에서 unzip 호환성 준비 후 실행합니다.

```powershell
git check-ignore .test-vault/.benchmarks/datasets/manifest.json
npm run bench:public -- download
if ($LASTEXITCODE -ne 0) { throw '다운로드 실패' }
npm run bench:public -- prepare-wix
if ($LASTEXITCODE -ne 0) { throw 'Wix 변환 실패' }
npm run bench:public -- prepare-enterprise
if ($LASTEXITCODE -ne 0) { throw 'Enterprise 변환 실패' }
git ls-files .test-vault
```

`git ls-files .test-vault`의 출력은 없어야 합니다. 원본 manifest의 해시·버전·파일 개수와 변환된 `documents.jsonl`의 개수를 검증합니다. 압축 파일·문서·정답은 숨김 `.benchmarks`에 두고 기존 인덱스에 섞지 않습니다. 네이티브 하네스가 실행할 때만 임시 공개 폴더와 독립 DB를 만듭니다.

## 8. Windows에서 재개할 순서

### 8.1 먼저 합성 검사와 소규모 연결 검증

1. 최신 원격 브랜치를 clone하거나 최신 bundle로 복원하고 `AGENTS.md`, 이 문서, 평가 스크립트/호출부/테스트를 읽습니다. 오래된 패치는 적용하지 않습니다. Ponytail을 새 환경에서 적용합니다.
2. Windows CLI·전용 볼트 인수·압축·npm runner 경계를 회귀 테스트부터 이식합니다. 평가 정의나 제품 설정을 바꾸는 이식은 하지 않습니다.
3. `npm run quality:local`의 Windows 실행 경계까지 정상화한 후 변경 범위 검사. TS를 바꾸면 lint → typecheck → 전체 테스트·i18n·UX·오프라인 계약. Rust/WASM 경계를 바꾸면 해당 Rust 검사도 수행합니다.
4. 관련 합성 테스트를 실행합니다.

```powershell
npx vitest run scripts/native-product-benchmark.test.mjs scripts/public-vault-benchmark.test.mjs scripts/enterprise-benchmark-score.test.mjs
if ($LASTEXITCODE -ne 0) { throw '벤치마크 계약 검사 실패' }
npm run quality:local
if ($LASTEXITCODE -ne 0) { throw '품질 검사 실패' }
```

5. 다른 실행 ID로 작은 코퍼스/문항 연결 검증. 아래 명령은 **Windows CLI 이식을 완료한 뒤에만** 사용할 수 있는 현재 CLI 형식입니다. 프로필 참조는 실제 설정과 맞춥니다.

```powershell
npm run bench:public:native -- wix 1 windows-smoke 1 - 25 --judge-model=profile:profile-3:gpt-6-luna
```

스모크는 정상 연결·취소·정리만 검증하며 공개 점수에 넣지 않습니다. 실제 모델 호출이므로 인증과 사용량을 확인합니다. `cleanup.json`의 `remaining: 0`, 임시 평가 세션 삭제, 독립 DB 제거, 일반 RAG 이벤트 복구, 창 타이머 복구도 확인합니다.

### 8.2 전체 평가는 데이터셋별로 실행

새 OS·소스·경로·빌드 지문이 바뀌므로 **macOS의 `session-completion-oct11-v2`를 재개 ID로 사용하지 않습니다.** 새 Windows 실행 ID를 사용합니다. 실제 설치 번들과 소스가 같아야 합니다. 실행 중 빌드·설정·코퍼스를 바꾸지 않습니다.

```powershell
npm run bench:public:answers -- windows-full 3 --judge-model=profile:profile-3:gpt-6-luna
```

이 suite 명령은 Wix 다음 Enterprise입니다. 장시간 실행의 관측·실패 중단을 쉽게 하려면 먼저 Wix를 별도로 완료하고 집계/정리를 확인한 다음 Enterprise를 시작하는 편이 좋습니다.

```powershell
npm run bench:public -- answers wix all - windows-wix-full 3 --judge-model=profile:profile-3:gpt-6-luna
# Wix 종료 상태와 결과·정리를 확인한 후 별도로 실행
npm run bench:public -- answers enterprise all - windows-enterprise-full 3 --judge-model=profile:profile-3:gpt-6-luna
```

두 명령을 무조건 한꺼번에 실행하지 않습니다. 기존 macOS 큐는 이식된 코드가 아니며 재사용하지 않습니다. 새 자동 후속 작업은 Windows 호스트와 새 경로/실행 ID를 대상으로 명시적으로 구성해야 합니다. 기존 macOS heartbeat를 활성화하면 안 됩니다.

같은 Windows 실행을 재개할 때는 같은 ID·문서/질문·반복·모델·설정·제품 빌드·채점 조건을 유지합니다. 하네스는 조건 불일치와 중복 행을 거부합니다. 실패 행을 지워 성공률을 높이지 않습니다. 인증/429에는 저장된 실패 종류와 복구 가능 시점을 확인하고, 모델 교체·유료 API·결제·allowlist 변경으로 우회하지 않습니다.

### 8.3 고사양 PC에서도 시간이 오래 걸릴 수 있음

문서 하나씩 실제 제품 청킹·임베딩·저장을 하므로 GPU만 빠르다고 전체가 즉시 끝나는 것은 아닙니다. macOS 로그에서 Wix 문서 준비만 수시간이 걸렸고 3,058개에서 중단했습니다. Enterprise는 511,962개로 훨씬 큽니다. 원문 읽기/해시, 문서 생성, 제품 색인, 임베딩, IndexedDB, 질문/판정 네트워크 시간을 각각 관측하고 SSD 여유 공간·메모리·GPU backend를 확인합니다. 현재 수치로 Windows 완료 시간을 확정할 수 없습니다.

정당한 제품 성능 개선은 합성 회귀 테스트와 R&R 진단으로 수행하고, 변경 뒤에는 새 빌드·새 평가 조건으로 전체 결과를 얻습니다. 성능을 위해 일부 문서만 넣거나 정답 위치를 미리 전달한 실행을 전체 제품 평가로 바꾸면 안 됩니다. 색인 구현은 제품과 같아야 하며 평가만 빠르게 만드는 별도 검색기를 만들지 않습니다.

## 9. 결과가 생긴 뒤 할 일

실행 결과는 ignored `.test-vault/.benchmarks/native-runs/<데이터셋>-all-<실행ID>/`에 생깁니다.

- `specification.json`: 고정 조건과 지문.
- `answers.jsonl`: 질문·반복별 결과. 원문/질문/답변/인용 식별 정보가 있으므로 Git/채팅에 전체 출력하지 않음.
- `summary.json`, `comparison.md`: 집계와 공개 게이트.
- Enterprise `official-protocol/`와 `official-answers-*.jsonl`: 공식 채점 자료/내보내기. Git 제외.
- `cleanup.json`: 실행 정리 확인. 결과 파일 존재만으로 정리를 완료했다고 하지 않음.

전체 Wix는 1,200회, Enterprise는 1,500회를 계획합니다. 실행 완료 수·고유 문항·반복·오류·판정 누락·추가 질문을 대조합니다. 정확성·완전성·인용의 의미적 지지·정답 문서 recall은 다른 지표입니다. 필수 문서를 찾은 것과 실제 필요한 구간을 확인해 답변에 반영한 것도 구분합니다. 반복을 독립 문항 수처럼 부풀리지 않고 질문 단위 신뢰구간을 확인합니다.

`publicClaims.publicReady`는 전체 범위·3회 이상 반복·독립 판정·오류/판정 미완료 조건을 검사합니다. 게이트 통과가 경쟁 우위나 사람 검수 완료를 보장하지 않습니다. 원문 정답을 고정하는 현재 Enterprise `no-correction` 결과는 공식 보정과 같지 않아 `leaderboardReady`가 별도로 차단됩니다. 공식 리더보드 조건을 검증하기 전에는 순위나 공식 점수처럼 소개하지 않습니다.

외부 점수는 실행 때 저장한 출처·날짜·CSV 해시·조건으로 다시 확인합니다. 기존 문서에 있는 CDL 90.91, OpenAI File Search 61.03, RAGFlow 50.24, AnythingLLM 35.58은 2026-10-11 확인 기록입니다. Salesforce Wix expert 92.5%는 표본·모델·판정 조건이 미공개여서 직접 우위 비교 자료가 아닙니다. 리더보드 최고점을 숨기고 낮은 점수만 선택하지 않습니다.

마케팅에서는 검증한 결과를 사용자 가치로 연결합니다. 예: 필요한 문서/사실을 덜 놓치는가, 근거가 실제 답을 뒷받침하는가, 흩어진 정보를 얼마나 완전하게 답하는가. 수치 가까이에 데이터셋·문항·반복·모델·판정자·날짜·한계를 둡니다. 공개 가능한 성공/실패 사례는 사전 고정 표본과 공개 허용 범위를 검토하고, 개인 테스트 볼트의 원문·검색 질의·고유 표현은 옮기지 않습니다. 안전한 시연은 독립 합성 노트로 만듭니다.

README와 `marketing/benchmarks.md`의 “검증 중”은 충분한 근거가 생긴 뒤에만 바꿉니다. 제품 페이지의 별도 저장소/배포 대상은 현재 확인되지 않았으므로 임의 웹 게시를 하지 않습니다. 이 브랜치에서 비교표·근거 문구·사례 자산을 먼저 완성합니다. 속도는 OS·하드웨어·앱 가시 상태·backend와 실패 포함 분모를 기록하고, 숨겨진 평가 창의 타이머 제한을 해제한 값을 일반 사용 속도라고 소개하지 않습니다.

## 10. 이미 끝난 것 / 아직 안 한 것

### 끝난 것

- MIT 후보 선정, 실제 다운로드·변환, 출처·버전·해시 기록.
- 합성 회귀 테스트와 예비 검색/12문항 답변 진단.
- 실제 Obsidian 제품 전체 평가 경로와 공식 Enterprise 채점 경로 구현.
- 독립 판정·조건 지문·실패 분모·재개·외부 스냅샷·시간/인용 지표 보강.
- macOS 관련 합성 검사와 소규모 실제 연결 검증.
- 이번 사용자 중단: 큐/caffeinate 종료, 자동화 일시 중지, 확인된 임시 공개 파일 제거.

### 안 한 것 / 재개 후 해야 하는 것

- Windows 호환성 수정·검증과 실제 설치/인증/임베딩 연결.
- Wix 전체 400문항 × 3회, Enterprise 전체 500문항 × 3회 완료.
- Enterprise 공식 정답 보정과 리더보드 비교 조건 검증/재현 자료. 리더보드 제출 자체는 별도 외부 게시 권한 확인 필요.
- 자동 판정과 사람 검수의 대조, 근거 구간 수준 지표의 해석 검증.
- 실제 결과에 기반한 README·최종 비교표·성공/실패 사례·화면 근거.
- 독립 성능/UX·대형 볼트 실험. 품질 평가 후 필요한 범위에 한정하며 Copilot 렌더링 수치와 답변 품질을 섞지 않음.
- 비용·메모리·채택 지표 등 조사에서 제안된 보조 지표의 실제 계측. 구현되지 않은 지표를 이미 측정한 것처럼 소개하지 않음.
- Windows에서 새로 수행할 호환성 변경과 이후 실제 결과의 영어 논리 단위 커밋. macOS 하네스 보강과 인계서는 이번 전달 커밋에 포함됐지만 Windows 이식·평가·최종 마케팅 결과는 아직 없음.

이전 표본 숫자는 실행 조건마다 다릅니다. 최초 Enterprise 12문항 BM25 5/12 → 반복 도구 8/12, Wix 8/12 → 8/12였고, 이후 별도 12문항 실행에서는 Wix BM25 7/12·도구 10/12·당시 제품 모드 9/12, Enterprise 부분집합 5/12·7/12·7/12였습니다. 이를 합치거나 최신 하이브리드 네이티브 제품 성적으로 바꾸지 않습니다. 전체 평가 완료와 경쟁 우위는 여전히 미입증입니다.

## 11. 하면 안 되는 일과 목표가 아닌 일

- 사용자 중단을 무시한 macOS 평가/heartbeat 재개, Windows 이전 전 새 전체 실행.
- 경쟁 플러그인 설치·직접 평가, 관련 없는 보관 채팅 작업 재개.
- BM25·벡터·도구 루프를 별도 제품으로 광고하거나 내부 축소 대조군을 경쟁 제품처럼 표현.
- 모델 지능 순위, 도구 호출 수, 테스트 통과 수 자체를 최종 마케팅 성과로 사용.
- 6/12문항·25문서·부분 출처 결과를 전체 점수나 경쟁 우위로 사용.
- 검색 recall을 답변 정확도로 표시, 다운로드 수를 사용자 수/품질로 표시, 성적을 목표값에 맞춰 게이트 완화.
- 무근거인 “항상 더 정확”, “출처 오류 감소”, “시간 절약”, “50만 문서 검증 완료” 문구.
- 모델/추론 강도 변경, 유료 API 도입, 계정 허용 목록 변경, 키·토큰 출력.
- 데이터·질문·정답·실행 로그·개인 노트·설정·캐시를 커밋, `git add -f .test-vault` 또는 `git add .`로 무분별한 스테이징.
- 기존 사용자 데이터나 Obsidian 프로필 전체 삭제, 실패 행 제거, 서로 다른 실행 지문/OS 결과 혼합.
- generated glue/base64 수동 수정, WASM 오류를 별도 TS 계산으로 숨김.
- 평가만 통과시키는 별도 제품 재구현, 특정 볼트 정답에 맞춘 런타임 변경, 불필요한 평가 프레임워크 확장.
- 새 main merge·배포·태그·릴리스·force push. 별도 요청 전에는 범위 밖.

## 12. 최종 완료 판정과 다음 에이전트에게 줄 요청

전체 실행과 정리, 결과 해석, 허용 가능한 소개 문구, 필요한 변경 검증, 데이터 제외 확인, 영어 커밋까지 끝나야 완료입니다. 같은 내용에 이미 통과한 검사를 이유 없이 반복하거나 일반 커밋에 온라인 Patina를 강제하지 않습니다. 릴리스 전 카피/보안 규칙은 `AGENTS.md`를 따릅니다.

Windows에서 새 채팅을 열 때 아래 요청을 사용할 수 있습니다. **현재 macOS에서 실행하라는 지시는 아닙니다.**

> `BENCHMARK_MARKETING_CONTINUE_GUIDE.md`와 `AGENTS.md`를 먼저 읽어줘. 현재 브랜치는 `codex/public-vault-benchmarks`야. 최신 원격 브랜치와 인계서, 하네스 보강 커밋 `5245def`가 포함됐는지 확인하고 Windows CLI/전용 볼트/압축/품질 runner 경계를 테스트부터 이식해줘. 오래된 미커밋 패치는 적용하지 마. Ponytail을 적용하고 실제 제품 전체 평가를 유지해. 생성 GPT-6.1 Sol, 임베딩 EmbeddingGemma 300M, 독립 판정 GPT-6 Luna를 유지해. Windows 소규모 연결·취소·정리 확인 후 WixQA 400문항과 Enterprise 핵심 500문항을 전체 코퍼스에서 각 3회 완료해줘. 실제 결과와 비교 조건을 검증하고 README·마케팅 자료를 완성한 뒤 데이터 없이 영어 논리 단위 커밋해줘. 경쟁 제품은 설치하지 말고 발표된 수치/조건만 비교해. 우위를 입증하지 못하면 그 원인과 한계를 솔직히 남겨. 기존 macOS 자동화/실행 ID는 재사용하지 말고 키·설정·개인 노트는 보존해.
