# @lectern/harness

v2 AI 워커 하네스다([AI_HARNESS.md](../../docs/v2/AI_HARNESS.md)). 단계 실행기와 메모이제이션(`runner.ts`, `stage.ts`), 블롭 저장소, 비용 원장, 공급자 어댑터, 전사 파이프라인(§11 3번), 평가 CLI(§11 4번)가 들어 있다.

## 전사 파이프라인

```
ingest → normalize → speech_map → chunk → transcribe ×N → merge → speakers
```

| 단계 | 하는 일 | 출력(산출물) | 메모 키에 들어가는 것 |
|---|---|---|---|
| `ingest` | `screenAudio`: 형식·길이·sha256, 무음·손상·빈 파일 거부 | `IngestOutput` | 업로드 sha256, 거부 규칙 |
| `normalize` | 모노 16kHz, -16 LUFS 무손실 FLAC 작업본 | `NormalizeOutput` + `audio_work` 블롭 | 업로드 sha256, `NORMALIZE_VERSION`, 기본값 |
| `speech_map` | 무음 검출 → 휴식·꼬리 판정 → 시간 맵 → 발화 전용 오디오 | `SpeechMapOutput` + `audio_speech` 블롭(자른 게 없으면 작업본을 그대로 씀) | 작업본 sha256, `SPEECH_MAP_VERSION`, 규칙, 임계값 |
| `chunk` | 무음 경계·15~30초 겹침으로 나누고 AAC 32kbps로 인코딩 | `ChunkOutput`(chunks.json, 경로 대신 sha256) + 청크마다 `audio_chunk` 블롭 | 발화 오디오 sha256, 무음 목록 해시, `CHUNK_PLAN_VERSION`, 계획 설정 |
| `transcribe` | 청크마다 공급자 호출 → §3.4 검사 | domain `TranscribeResult`(청크 상대 시간) | 청크 sha256, 프롬프트 파일 해시, 공급자, 모델, 요청 파라미터(스키마 해시·thinking·MIME), 언어·화자 수 힌트 |
| `merge` | 겹침 정렬·이어 붙이기, **원본 시간 복원(유일한 적용 지점)**, 휴식·꼬리·누락 구간 | `MergedTranscript` | 전사 결과 해시들, 청크 계획·시간 맵 해시, 규칙 |
| `speakers` | 청크별 화자 라벨 통합 | `Transcript`(발행할 결과) | merge 출력 해시, 규칙 |

- 모든 단계가 `memo: "shared"`다. 같은 워크스페이스에 같은 파일을 다시 올리면 아무것도 다시 돌지 않는다. 청크 전사는 청크 오디오만으로 정해지므로 다른 녹음의 같은 오디오도 재사용한다.
- 단계 사이에는 **블롭 sha256만** 넘긴다. 임시 디렉터리 경로를 출력에 남기면 크래시 후 메모 적중이 사라진 파일을 가리키기 때문이다. 다음 단계는 `ctx.blobs.path(sha256)`로 읽는다.
- 같은 작업으로 `runTranscriptPipeline`을 다시 부르면 이어서 돈다. 끝난 단계는 저장된 출력을 돌려주고 중단된 단계만 다시 돈다(`test/transcript-crash.test.ts`가 SIGKILL로 확인).

### 공개 API

```ts
import { Harness, GeminiTranscriptionProvider, runTranscriptPipeline } from "@lectern/harness";

const harness = new Harness({ db, blobDir: HARNESS_BLOB_DIR, logger });
const run = harness.job({ jobId, scope: workspaceId ?? `owner:${ownerId}`, workspaceId, signal, onEvent });
const provider = new GeminiTranscriptionProvider({ apiKey: () => config.geminiApiKey, timeoutMs: 300_000 });
const result = await runTranscriptPipeline(run, { audioPath, language: "ko" }, { provider, workDir: join(DATA_DIR, "work") });
// result.transcript: { segments: [{ idx, start_ms, end_ms, speaker, text, source_chunk }], speakers, gaps, failed_chunks }
```

| 이름 | 파일 | 설명 |
|---|---|---|
| `runTranscriptPipeline(run, input, options)` | `transcript/pipeline.ts` | 위 7단계를 한 작업으로. `options`: `provider`, `workDir`, `chunk`(기본 6분·15~30초 겹침, `targetMs: null`이면 통째로), `speechMap`(`rules`, `noiseDb`), `concurrency`(기본 3), `onStage` |
| `ingestStage` … `speakersStage`, `transcribeStage(provider)` | `transcript/stages.ts` | 단계 정의. 따로 돌리거나 다른 조합을 만들 때 쓴다 |
| `GeminiTranscriptionProvider` | `gemini-transcribe.ts` | `gemini-3.8-flash` 고정(허용 목록 `resolveGeminiModel`), 인라인 오디오, `responseSchema`, `thinkingLevel: "low"`, `MM:SS` → ms |
| `TranscriptionProvider` | `providers.ts` | `id`, `model`, `maxChunkSeconds`, `fingerprint`(메모 키), `transcribe(RenderedChunk, opts)` |
| `checkTranscription`, `TRANSCRIBE_CHECKS` | `transcript/validate.ts` | §3.4 결정적 검사 |
| `mergeTranscripts`, `MERGE_DEFAULTS` | `transcript/merge.ts` | 순수 함수. 테스트는 `test/merge.test.ts` |
| `unifySpeakers`, `SPEAKER_DEFAULTS` | `transcript/speakers.ts` | 순수 함수 |
| `Transcript`, `MergedTranscript`, `ChunkOutput`, … | `transcript/schemas.ts` | 단계 출력 zod 스키마 |
| `HarnessError.code`, `HarnessError.billed` | `errors.ts` | 거부 사유 코드(`silent`, `empty_response` …)와, 응답은 왔지만 쓸 수 없는 호출의 사용량. `ctx.meter`가 `billed`를 원장에 `status: "error"`로 남긴다 |

### 실패 처리

| 상황 | 분류 | 처리 |
|---|---|---|
| 무음·손상·빈 파일·지원하지 않는 코덱 | `input`, `code` = media 거부 코드 | `ingest`에서 즉시 실패. 메시지는 사용자용 한국어 |
| ffmpeg 없음 / ffmpeg 비정상 종료 | `config` / `transient` | 미디어 단계는 2회까지 시도 |
| 429·5xx·네트워크 | `transient` | 청크당 4회까지 백오프(429는 `retryDelay`를 따름) |
| 빈 응답, `MAX_TOKENS`, 차단, JSON·스키마·시간 형식 오류 | `output_validation` + `billed` | 비용을 원장에 남기고 1회 수리 재시도 |
| §3.4 검사 실패(시간, 커버리지, 반복 루프, 빈 세그먼트, 언어) | `output_validation` | 이슈 목록을 프롬프트에 넣어 1회 수리 재시도 |
| 위 재시도 후에도 실패한 청크 | — | **전사 누락** 구간으로 표시하고 계속(부분 결과). 모든 청크가 실패하면 작업 실패 |
| 키 없음·401/403, 예산 초과, 취소 | `config` / `budget` / `canceled` | 남은 청크를 시작하지 않고 작업 실패 |

### merge의 규칙

- 겹침마다 두 청크의 글자(문자·숫자만)를 Smith–Waterman으로 정렬하고, 일치하는 글자 하나에서 잇는다(앞 청크는 그 글자 앞까지, 뒤 청크는 그 글자부터). 이음 지점은 **뒤 청크의 시간**으로 이음매에 가장 가까운 곳을 고른다. LLM 타임스탬프는 청크 안에서 누적해 밀리므로(§3.3) 청크 앞부분 시간이 더 믿을 만하다. 앞 청크 창은 겹침 60초 앞까지 본다.
- 쓸 만한 일치가 없으면(겹침이 무음이거나 두 전사가 크게 다르면) 이음매(무음 위) 기준으로 각자 자기 쪽에서 시작하는 세그먼트만 남긴다.
- 이음 글자의 두 시간 차가 앞 청크의 밀림이다(`seams[].drift_ms`). 2초 이상이고 25% 이내면 앞 청크의 시간을 청크 시작 기준으로 선형 보정한다.
- 원본 시간 복원은 여기서 한 번만 한다. 잘린 지점을 걸친 세그먼트는 더 긴 쪽으로 자른다(20분 휴식을 걸치는 세그먼트가 생기지 않는다). 실패한 청크는 이웃이 전사하지 못한 범위를 원본 시간 조각별 `missing_transcript`로 남긴다.
- 30초가 넘는 세그먼트는 문장 경계에서 나눈다.

### speakers의 규칙

1. 겹침 정렬에서 같은 글자를 말한 (앞 라벨, 뒤 라벨) 쌍이 서로 최선이고 8글자 이상이면 같은 사람이다(신뢰도 0.9).
2. 이웃 청크 둘 다 글자의 60% 이상을 차지하는 화자가 있으면 그 둘을 잇는다(0.6). 강의에서 겹침이 무음일 때.
3. 이웃 청크에서 아직 이어지지 않은 라벨이 양쪽에 하나씩만 남으면 그 둘을 잇는다(0.6). 인터뷰의 두 번째 화자.
4. 한 청크의 두 라벨은 절대 합치지 않는다. 증거가 강한 연결부터 적용한다.
5. 전체 라벨은 처음 등장한 순서로 S1, S2…를 붙인다. 증거가 없는 라벨은 따로 남는다(0.5). 청크가 하나면 신뢰도 1.

**모델 호출(미구현, §3.5 대안)**: 규칙으로 못 이은 라벨이 남을 때만, 청크·라벨마다 대표 발화 3줄(약 30토큰씩)을 모아 `gemini-3.5-flash-lite`에 "같은 사람끼리 묶어라"를 JSON으로 묻는다. 녹음 1건당 1회, 입력 약 4,000토큰, 출력 약 200토큰 → **약 $0.0017**(1시간 녹음 기준, 청크 10개·라벨 4개). 평가에서 화자 오류가 기준을 넘을 때 켠다.

### 녹음 1시간당 전사 비용 (gemini-3.8-flash, 2026-10-19 공식 가격 재확인: 입력·오디오 $0.75/M, 출력·thinking $3.75/M, 2027-01-01부터 2배)

| 항목 | 토큰 | 비용 |
|---|---|---|
| 오디오 3,600초 + 겹침 약 6%(이음매 9개 × 평균 22.5초) | 32/초 → 약 121,700 | $0.091 |
| 프롬프트·스키마 약 600토큰 × 청크 10개 | 6,000 | $0.005 |
| 출력: 한국어 전사 약 11,000 + JSON 키·시간 약 10,000 | 약 21,000 | $0.079 |
| thinking (`low`, 추정 청크당 300~1,500) | 3,000~15,000 | $0.011~0.056 |
| **합계** | | **약 $0.19~0.23** (2027-01 이후 $0.37~0.46) |

- 발화가 없는 휴식·꼬리를 잘라 낸 만큼(강의 10~30%) 오디오와 출력 비용이 함께 준다.
- 검증 실패로 수리 재시도가 나면 그 청크 비용이 한 번 더 든다.
- 가장 큰 불확실성은 thinking 토큰이다. 평가 실행의 원장(`ai_call.output_tokens`에 thinking이 포함됨)으로 실제 값을 잰다.
- 줄일 수단: thinking 수준, 응답 스키마 축소(`end` 생략 등), `gemini-3.5-flash-lite`(같은 가정으로 약 $0.10~0.13), 급하지 않은 재처리는 배치 API(50%).

### 서버 연결 (`shadow`까지)

`apps/server/src/transcript-job.ts`가 `transcribe` 작업으로 이 파이프라인을 돌린다. 켜고 끄는 절차는 [host-setup.md §10](../../docs/runbooks/host-setup.md#10-전사-시험-처리-켜기와-끄기-lectern_transcript_engine).

1. **기능 플래그** `LECTERN_TRANSCRIPT_ENGINE`(`off` | `shadow` | `on`, 기본 `off`). 작업이 돌 때마다 읽으므로 큐에 있던 작업도 `off`면 아무것도 하지 않고 끝난다.
2. **작업**: 서버 키로 한 distill이 노트를 발행하면(`job-handlers.ts` `afterDistillPublished`) `transcribe` 작업(subject = 강의 id, 동시성 1, 녹음 길이에 비례한 `budget_microusd`)을 큐에 넣는다. 사용자가 자기 키로 올린 녹음, 서버 키 사용이 제한된 계정, 환경 변수에 키가 없거나 ffmpeg·ffprobe가 없으면 넣지 않는다. 핸들러는 `harness.job({ jobId, scope: workspaceId, workspaceId, signal })`(workspaceId = `personalWorkspaceId(owner)`), `GeminiTranscriptionProvider({ apiKey: () => readSecret("GEMINI_API_KEY") })`, `workDir = DATA_DIR/work`로 `runTranscriptPipeline`을 부른다. lease를 회수당한 작업은 같은 jobId로 다시 불려 이어서 돈다(`apps/server/test/transcript-job.test.ts`가 워커 SIGKILL → 회수 → 재개로 확인).
3. **취소**: 단계를 시작하거나 재시도할 때마다 강의와 오디오 파일이 그대로인지 보고, 지워졌으면 `signal`로 멈추고 그 작업의 산출물을 지운다.
4. **압축**: 전사가 원본 오디오를 읽으므로 자동 압축은 전사 작업이 끝난 뒤(`JobOutcome.followUp`, 작업 행이 끝난 다음)에 큐에 넣는다. 압축 작업은 `transcribe`가 도는 동안 거부한다.
5. **shadow 저장**: 전사는 `speakers` 단계 산출물(블롭)로 남고 강의 행·SSE는 건드리지 않는다. `job.result`에는 본문 없이 개수와 참조만 둔다(`transcript_artifact`, segments, speakers, gaps, failed_chunks, spent_microusd). 진행은 로그(`transcript stage`)로만 본다. 산출물은 녹음·오디오 삭제 때, 아니면 작업이 끝나고 30일 뒤 유지보수가 지운다. 1시간 녹음마다 블롭 약 225MB.
6. **`on`(아직 shadow와 같다)**: `result.transcript`를 한 트랜잭션으로 `transcript_segment`(idx, 원본 ms, `source_chunk`), `speaker`(label, confidence), `transcript_gap` 행으로 쓴다. 필요한 것: P2 백엔드의 세 테이블(`packages/db` 0003), 강의 id → `recording.id`(`recording.lecture_id`), 세그먼트보다 먼저 만드는 `speaker.id`(`transcript_segment.speaker_id`), `chunkFailures`가 있으면 부분 결과 표시, P2 `api/v2/events.ts`의 `job.progress`(지금은 v1 강의 진행을 `legacy_distill`로 보냄)에 전사 단계를 싣는 방법. `on`에서는 사용자에게 보이는 결과이므로 사용자 키 작업도 그 키로 돌릴지 다시 정한다.
7. **ffmpeg 5.1 이상**이 필요하다(`packages/media/README.md`). CI 러너에는 ffmpeg가 없어 통합 테스트는 건너뛴다. 순수 테스트(merge, speakers, 검사, 어댑터, 지표)와 서버 연결의 조건 테스트는 항상 돈다.

### 알려진 한계

- 검증 실패 청크를 "더 잘게 나눠 재시도"하는 단계(§3.4)와 대체 공급자 전환은 아직 없다. 지금은 1회 수리 후 누락 구간이 된다.
- 드리프트 보정은 이음 지점 하나로 하는 선형 보정이다. 청크 중간에서 갑자기 밀리는 경우는 고치지 못한다.
- `GeminiTranscriptionProvider`의 요청 형식(`inlineData`의 `audio/mp4`, `responseSchema`의 `propertyOrdering`, `thinkingConfig.thinkingLevel`)은 문서 기준이고 실제 호출로는 확인하지 않았다. 첫 평가 실행이 확인이다.
- §3.4 검사의 "청크 길이 + 1초" 규칙은 타임스탬프가 늦게 밀리는 청크를 거부한다. 평가에서 밀림 방향과 크기를 보고 조정한다.

## 평가 CLI

```bash
bun run harness eval
```

- 기본값은 내장 합성 세트(`eval/example`)와 스크립트 공급자다. 녹음도 비용도 없다. 실행 예: `bun run harness eval --noise 0.05 --drift -0.1`
- 실제 세트: `bun run harness eval --set ~/lectern-eval/sets/v0 --provider gemini`. 예상 비용(상한)을 출력하고 멈춘다. `--yes`를 붙여야 호출한다.
- 결과는 `<평가 루트>/runs/<날짜>-<라벨>.json`이고 `--baseline <이전 run.json>`으로 비교한다. 캐시(SQLite·블롭·합성 오디오)는 `<평가 루트>/.cache/<세트>`에 있어서, 프롬프트·모델·오디오가 같으면 다시 전사하지 않는다.
- 세트 형식과 넣는 위치는 [eval/README.md](eval/README.md).
