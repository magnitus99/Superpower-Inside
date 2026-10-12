# Windows 벤치마크·마케팅 작업 이어가기

2026-10-12 기준의 현재 실행·마이그레이션 안내입니다. 이전 구성은 이 문서에 보존하지 않으며 Git 이력에서 확인합니다. 작업 규칙은 루트와 해당 경로의 `AGENTS.md`를 따릅니다.

## 목표와 현재 구성

Superpower Inside가 흩어진 문서에서 필요한 근거를 찾고 최종 답변에 활용하는 능력을 실제 제품으로 측정합니다. 청킹·임베딩·BM25·하이브리드 검색·볼트 도구·채팅·출처 표시까지 설치된 제품의 경로를 사용합니다. 결과에 없는 경쟁 우위나 품질 개선을 주장하지 않습니다.

| 자료                                                     | 전체 문서 |                       질문 | 역할·라이선스                                              |
| -------------------------------------------------------- | --------: | -------------------------: | ---------------------------------------------------------- |
| [MultiHop-RAG](https://github.com/yixuantt/MultiHop-RAG) |       609 |                      2,556 | 주 평가. 여러 문서의 추론·비교·시간 관계·정보 부재. ODC-BY |
| [WixQA](https://huggingface.co/datasets/Wix/WixQA)       |     6,221 | expert 200 + simulated 200 | 보조 평가. 실제 사용자 질문의 답변 정확성·완전성. MIT      |

전체 코퍼스는 6,830개 문서입니다. WixQA synthetic 6,221문항은 검색 진단용으로만 사용하고 주 답변 점수에 섞지 않습니다. EnterpriseRAG-Bench는 다운로드·변환·실행 큐에서 제외합니다. 출처 표기형 공개 라이선스를 허용한다는 사용자 결정을 반영합니다.

MultiHop-RAG에는 추론 816·비교 856·시간 관계 583·정보 부재 301문항이 있습니다. 정보 부재 문항은 정답 근거가 없는 문항이며 답변 가능한 질문과 별도로 보고합니다. 공개 데이터의 질문과 정답도 제품이 읽는 코퍼스에는 넣지 않습니다.

## 실제 실행 조건

- 생성·자동 판정 모델: Command Code의 **DS v4.1 Flash**만 사용합니다. 모델 ID는 `deepseek/deepseek-v4.1-flash`, 현재 로컬 참조는 `profile:profile-4:deepseek/deepseek-v4.1-flash`입니다.
- 제공 서버는 `https://api.commandcode.ai`의 등록된 OpenAI 호환 API 연결입니다. 생성·도구 후속 응답·자동 판정에 OpenAI ChatGPT OAuth 또는 다른 모델을 사용하지 않습니다. OpenAI 호환 요청 형식은 ChatGPT OAuth 인증과 구분합니다.
- 실행 코드가 생성·판정 모델과 제공 서버를 확인하며 허용되지 않은 선택은 호출 전에 중단합니다. 판정 모델을 생략하면 같은 DS v4.1 Flash를 사용합니다. 같은 모델의 자동 판정이므로 독립 판정으로 표시하지 않습니다.
- 임베딩: EmbeddingGemma 300M. 현재 로컬 참조는 `profile:ternlight:embeddinggemma-300m`입니다.
- 모델·추론 강도·기존 사용자 설정은 임의로 변경하지 않습니다. 새 환경에서는 모델 참조를 등록된 실제 프로필 값에 맞춥니다.
- 테스트 볼트의 보이는 고정 폴더에 모든 코퍼스를 둡니다. 플러그인의 실제 제품 인덱스·캐시로 임베딩을 마친 뒤 질문을 실행합니다.
- 별도 모의 인덱스나 매 실행마다 만들고 삭제하는 임시 코퍼스로 본 평가를 대체하지 않습니다. 평가 종료 후에도 고정 코퍼스와 실제 제품 인덱스를 유지합니다.
- 평가마다 해당 데이터셋 폴더 멘션으로 범위를 지정하고 제품 도구의 범위도 일치시킵니다. 다른 데이터셋의 근거가 답변에 섞이지 않도록 합니다.
- 질문·정답·실행 결과·인증 자료는 숨겨진 로컬 관리 디렉터리에 둡니다. 문서 본문과 원본 식별 정보는 Git·공유 보고서에 포함하지 않습니다.
- 예약 태스크는 삭제했습니다. 요청 없이 새 타이머나 자동 후속 태스크를 만들지 않습니다.

## 현재 상태

Windows 작업 경로는 `D:\Repository\Superpower-Inside`, 브랜치는 `codex/public-vault-benchmarks`, 제품 버전은 `3.0.0`입니다. 새 자료와 고정 볼트 실행 경로, 전송 중 JSON 재독 처리에 더해 Command Code DS v4.1 Flash 전용 모델 검증을 적용했습니다. 모델이나 제품 설정이 실행 중 바뀌면 반복 호출을 계속하지 않고 중단합니다. 합성 벤치마크 회귀 테스트 47개와 `npm run quality:local`(전체 테스트 1,604개 통과·1개 제외, 오프라인 채팅 계약 184/184, community review)을 통과한 조건으로 다시 실행합니다.

두 코퍼스의 다운로드·변환·보이는 폴더 복사와 내용 대조를 완료했습니다. Enterprise의 보이는 폴더와 로컬 다운로드 폴더는 삭제된 상태를 확인했습니다. Enterprise의 Obsidian 파일 캐시 511,962개와 다른 문서에서 사용하지 않는 메타데이터 22,053개도 제거했습니다. 복구용 임시 볼트·등록·DB·스크립트는 작업 영역에서 정리했습니다. 실제 제품의 WebGPU 인덱싱이 완료됐으며, 문서 처리 상태는 MultiHop-RAG 609/609·WixQA 6,221/6,221이고 두 코퍼스의 검색 readiness는 모두 `ready`입니다. 생성·판정 모델을 DS v4.1 Flash로 통일했으며 이전 모델의 결과를 새 실행에 합치거나 공개 성적으로 사용하지 않습니다. 새 모델의 전체 반복 평가와 최종 마케팅 수치는 아직 완료되지 않았습니다.

| 경로                                          | 용도                                               |
| --------------------------------------------- | -------------------------------------------------- |
| `.test-vault/Benchmarks/MultiHop-RAG/Corpus/` | 실제 제품이 읽는 609개 문서                        |
| `.test-vault/Benchmarks/WixQA/Corpus/`        | expert·simulated·synthetic이 공유하는 6,221개 문서 |
| `.test-vault/.benchmarks/datasets/`           | 원본 코퍼스·질문·정답·출처·라이선스·버전·해시      |
| `.test-vault/.benchmarks/native-runs/`        | 실행 조건·답변·판정·집계·진행 기록                 |
| `.test-vault/.benchmarks/native-work/`        | 실행 중 bridge. 완료 후 정리                       |

모든 코퍼스는 전체를 인덱싱합니다. 질문 수를 줄인 연결 검증도 문서 코퍼스를 줄이지 않습니다. 부분 질문 실행에는 부분 평가 표시가 필요하며 전체 공개 성적으로 사용하지 않습니다.

사용자 요청으로 백그라운드 평가를 취소했습니다. 실행 ID는 `windows-commandcode-ds41-oct12-v1`, 연결 검증은 같은 ID에 `-smoke`를 붙입니다. 로컬 `.test-vault/.benchmarks/persistent-suite-status.json`에서 취소 상태와 완료된 건수를 확인합니다. 연결 검증 4문항은 실행 오류·미판정 없이 끝났으나 정답 정확성·근거 지지는 모두 0/4로 판정됐습니다. 부분 결과를 전체 성적으로 사용하지 않습니다. 현재 평가 프로세스와 예약 태스크는 없으며, 사용자 재시작 요청 전에는 새 평가를 실행하지 않습니다.

## 새 Windows 환경으로 이전

저장소와 의존성은 새 환경에 준비합니다. 개인 볼트, `data.json`, API 키, OS별 IndexedDB, 실행 중 bridge/PID/stop 파일은 Git에 넣거나 그대로 이전하지 않습니다. Command Code API 인증과 로컬 임베딩 모델 파일은 새 환경에서 준비하고 실제 제품 인덱스를 다시 만듭니다.

```powershell
git clone --branch codex/public-vault-benchmarks https://github.com/magnitus99/Superpower-Inside.git D:\Work\Superpower-Inside
if ($LASTEXITCODE -ne 0) { throw 'clone 실패' }
Set-Location D:\Work\Superpower-Inside
npm ci
if ($LASTEXITCODE -ne 0) { throw '의존성 설치 실패' }
```

새 clone에 필요한 변경이 포함됐는지는 이동 직전 `git status --short --branch`와 원격 HEAD로 확인합니다. 커밋·푸시는 사용자 요청 범위에서만 수행합니다.

Obsidian에 전용 `.test-vault`를 열고 플러그인을 활성화합니다. 테스트 볼트에 제품의 `main.js`, `manifest.json`, `styles.css`와 임베딩 실행 자산을 설치합니다. Command Code의 OpenAI 호환 연결에 API 인증과 `deepseek/deepseek-v4.1-flash` 모델을 등록하고 기본 생성 모델로 선택합니다. 프로필 ID는 환경마다 달라도 모델 ID와 제공 서버는 일치해야 합니다. Windows CLI는 다음 위치를 확인합니다.

```powershell
$obsidianCli = Join-Path $env:LOCALAPPDATA 'Programs\Obsidian\Obsidian.com'
& $obsidianCli vault=.test-vault version
```

네이티브 앱의 마우스·타이핑 자동화 없이 CLI·코드·로그를 사용합니다. 앱이 실행 중이어야 CLI가 연결됩니다.

## 다운로드·변환·볼트 준비

```powershell
npm run bench:public -- download
if ($LASTEXITCODE -ne 0) { throw '다운로드 실패' }
npm run bench:public -- prepare-multihop
if ($LASTEXITCODE -ne 0) { throw 'MultiHop-RAG 변환 실패' }
npm run bench:public -- prepare-wix
if ($LASTEXITCODE -ne 0) { throw 'WixQA 변환 실패' }
npm run bench:public -- materialize
if ($LASTEXITCODE -ne 0) { throw '보이는 코퍼스 준비 실패' }
```

다운로드 manifest의 revision과 각 파일 SHA-256으로 원본 버전을 고정합니다. WixQA 본문은 원문 그대로 사용합니다. MultiHop-RAG 문서에는 원래 제목·작성자·출처·날짜·URL·본문을 포함하고 질문별 정답이나 근거 사실은 넣지 않습니다. 이 메타데이터도 질문에 필요한 근거이므로 삭제하지 않습니다.

보이는 파일 수 609·6,221과 체크섬을 확인하고, 플러그인의 일반 색인 기능으로 전체 임베딩을 완료합니다. 실제 제품의 문서 처리 상태와 검색 인덱스 readiness를 함께 확인합니다. CLI가 명령을 접수했다는 응답만으로 색인 완료를 인정하지 않습니다. 실행 bridge도 전체 문서 완료와 readiness를 확인하기 전에는 첫 질문을 보내지 않습니다.

## 연결 검증·전체 실행

합성 회귀 테스트와 변경 범위 품질 검사를 통과한 뒤 고정 전체 코퍼스에서 소수 질문으로 연결을 검증합니다. 생성·판정 모델, 제품의 최종 답변·출처, 근거 원문 대응, 정보 부재 문항을 확인합니다.

```powershell
npm run bench:public:native -- multihop 4 commandcode-ds41-smoke 1
if ($LASTEXITCODE -ne 0) { throw '연결 검증 실패' }
npm run bench:public:answers -- commandcode-ds41-full 3
if ($LASTEXITCODE -ne 0) { throw '전체 평가 실패' }
```

전체 큐는 MultiHop-RAG 2,556문항 → WixQA 400문항이며 각각 3회 반복합니다. DS v4.1 Flash의 8,868개 제품 응답과 동일 모델의 자동 판정을 계획합니다. 판정 모델을 명시하려면 생성과 같은 Command Code DS 모델 참조만 사용합니다. 인증·사용량 제한·시간 초과·판정 실패·모델 제한·설정 변경을 구분하고 미완료 실행을 완료로 보고하지 않습니다. 데이터·설정·빌드·실행 프로토콜이 바뀌면 새 실행 ID를 사용합니다.

## 집계·마케팅 반영

답변 정확성, 완전성, 실제 인용 원문의 지지, 필수 문서 확보, 정보 부재 대응을 각각 집계합니다. 오류·미판정·추가 질문·미실행을 성공 분모에서 빼지 않습니다. 반복 신뢰구간은 질문 단위로 계산합니다. 준비 시간과 응답 시간을 구분합니다.

공개 성능 수치는 전체 코퍼스·전체 질문·3회 이상 반복·오류 0·독립 판정을 충족해야 합니다. 현재 단일 모델 조건의 자체 판정은 독립 판정 조건을 충족하지 않으므로 공개 성능 주장 게이트를 통과시키지 않습니다. 부분 평가와 내부 진단에는 해당 범위와 자체 판정임을 명시합니다. 이번 자동 판정 지표를 논문 또는 다른 제품의 공식 점수와 같은 지표로 표시하지 않습니다.

경쟁 플러그인을 설치하지 않고 공식 공개 결과와 조건을 조사합니다. 코퍼스·질문·모델·프롬프트·채점·실행 환경이 일치하지 않으면 배수·순위·경쟁 우위를 주장하지 않습니다. 실행을 마친 검증된 수치만 한·영 README와 `marketing/benchmarks.md`에 반영합니다. 대표 성공 사례와 실패 사례도 식별 가능한 볼트 내용을 공유하지 않는 범위에서 준비합니다.

출처는 Wix.com AI Research 및 Yixuan Tang·Yi Yang의 MultiHop-RAG(COLM 2024)입니다. MIT 고지와 ODC-BY 출처·라이선스 링크를 유지합니다. 원문·QA·임베딩·로컬 실행 기록은 Git에서 제외합니다.
