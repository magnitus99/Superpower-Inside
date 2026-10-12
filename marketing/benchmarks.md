# 문서의 근거가 답변으로 이어지는지 확인하기

Superpower Inside는 실제 Obsidian 볼트에서 문서를 찾고 답변을 작성합니다. 공개 자료를 볼트의 보이는 폴더에 넣고, 평소 사용하는 플러그인의 인덱스와 임베딩 캐시를 준비한 뒤 채팅과 출처를 함께 평가합니다.

전체 코퍼스의 인덱싱을 마치고 Command Code DS v4.1 Flash로 평가를 시작했으나, 현재 사용자 요청으로 실행을 취소했습니다. 전체 반복 평가가 완료되지 않아 공개할 제품 성능 수치와 경쟁 우위는 아직 확인하지 못했습니다.

| 공개 벤치마크                                            | 확인하는 능력                                                 | 평가 범위                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| [MultiHop-RAG](https://github.com/yixuantt/MultiHop-RAG) | 여러 문서의 추론·비교·시간 관계, 근거가 없는 질문에 대한 대응 | 문서 609개·질문 2,556개·3회 반복                          |
| [WixQA](https://huggingface.co/datasets/Wix/WixQA)       | 실제 사용자 질문에 대한 정확하고 완전한 답변                  | 문서 6,221개·expert 200문항·simulated 200문항·각 3회 반복 |

WixQA synthetic 질문은 검색 진단에만 사용합니다. 두 자료의 점수는 따로 보고하며 통합 점수로 합치지 않습니다. 문서·질문·정답을 축소해 얻은 결과에는 평가 범위를 명시합니다.

## 측정 방법

문서 청킹·임베딩·BM25·하이브리드 검색·컨텍스트·볼트 도구·최종 답변은 설치된 제품의 구현과 선택한 설정을 사용합니다. 각 데이터셋의 전체 코퍼스를 먼저 인덱싱하고, 해당 폴더 범위로 질문합니다. 인덱스 준비 완료를 확인하기 전에는 답변 평가를 시작하지 않습니다.

답변 정확성·완전성·실제 인용 구간의 지지·필수 문서 확보를 각각 측정합니다. MultiHop-RAG의 정보 부재 301문항은 근거 없이 답을 만드는지와 적절히 답변을 유보하는지를 별도로 확인합니다.

모든 답변 생성·도구 후속 응답·자동 판정은 **Command Code의 DS v4.1 Flash**(`deepseek/deepseek-v4.1-flash`)만 사용합니다. 제공 서버는 `api.commandcode.ai`이며 OpenAI ChatGPT OAuth로 벤치마크를 실행하지 않습니다. 실행 코드가 서버와 등록 모델을 확인해 다른 선택을 차단합니다. 임베딩은 기존 로컬 EmbeddingGemma 300M 인덱스를 사용합니다.

동일 모델의 자체 판정이므로 독립 판정 결과로 표현하지 않습니다. 임베딩 모델과 제품 설정·빌드·코퍼스 버전·원문 체크섬·반복 횟수도 실행 조건에 기록합니다. 이 자동 판정 지표는 논문이나 다른 제품의 공식 점수와 구분합니다. 기존 공개 검증 조건 중 독립 판정 조건은 유지하며 현재 단일 모델 실행은 그 조건을 충족하지 않습니다.

| 결과 상태             | 조건                                                      | 표현                                   |
| --------------------- | --------------------------------------------------------- | -------------------------------------- |
| 내부 검증             | 연결 검증 또는 명시한 질문 표본                           | 범위와 오류·미판정을 함께 보고         |
| 공개 가능한 자체 측정 | 전체 코퍼스·전체 질문·3회 이상 반복·실행 오류 0·독립 판정 | 지표 정의·조건·한계를 붙인 제품 측정값 |
| 경쟁 제품 비교        | 같은 자료·질문·모델·채점·실행 조건 확인                   | 일치한 범위에서만 직접 비교            |

오류·판정 실패·추가 질문·미실행을 성공으로 계산하지 않습니다. 반복 신뢰구간은 질문 단위로 계산하고 준비 시간과 응답 시간을 구분합니다. 평가 창의 백그라운드 타이머 제한을 일시 해제한 실행 조건도 기록합니다.

경쟁 플러그인은 설치하지 않습니다. 이미 발표된 공식 수치를 조사하되 조건이 다른 결과로 순위·배수·경쟁 우위를 주장하지 않습니다. 현재 직접 비교할 수 있는 경쟁 제품 수치는 확정하지 않았습니다.

## 재현

Windows PowerShell에서 실행합니다. 전용 테스트 볼트에 플러그인·인증·선택한 모델과 임베딩 자산이 준비돼 있고 Obsidian이 실행 중이어야 합니다.

```powershell
npm run bench:public -- download
if ($LASTEXITCODE -ne 0) { throw '다운로드 실패' }
npm run bench:public -- prepare-multihop
if ($LASTEXITCODE -ne 0) { throw 'MultiHop-RAG 변환 실패' }
npm run bench:public -- prepare-wix
if ($LASTEXITCODE -ne 0) { throw 'WixQA 변환 실패' }
npm run bench:public -- materialize
if ($LASTEXITCODE -ne 0) { throw '볼트 준비 실패' }
```

`Benchmarks/MultiHop-RAG/Corpus`와 `Benchmarks/WixQA/Corpus`의 문서가 실제 제품에서 모두 처리됐는지 확인합니다. Command Code의 OpenAI 호환 연결에 `deepseek/deepseek-v4.1-flash`를 등록하고 기본 생성 모델로 선택한 뒤 전체 평가를 실행합니다. 판정 모델을 생략하면 같은 Command Code DS 모델을 사용합니다.

```powershell
npm run bench:public:answers -- commandcode-ds41-full 3
```

큐는 MultiHop-RAG 전체 → WixQA expert·simulated 전체 순서입니다. 두 벤치마크 모두 같은 Command Code DS 모델을 사용합니다. 실행 기록은 Git에서 제외한 `.test-vault/.benchmarks/native-runs/`에 저장합니다. 고정 코퍼스와 제품 인덱스는 다음 실행에도 사용하고, 임시 bridge·생성한 평가용 채팅은 종료 후 정리합니다. 데이터·설정·제품 빌드가 바뀌면 새 실행 ID를 사용하고 이전 모델의 결과를 합치지 않습니다.

## 출처

WixQA는 **Wix.com AI Research**의 MIT 자료입니다. MultiHop-RAG는 **Yixuan Tang·Yi Yang, COLM 2024**의 [ODC-BY 자료](https://huggingface.co/datasets/yixuantt/MultiHopRAG)입니다. 원본 출처와 라이선스 고지를 유지하며 원문·질문·정답·임베딩·로컬 실행 기록은 Git에 포함하지 않습니다.
