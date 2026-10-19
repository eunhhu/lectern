# @lectern/media

v2 하네스의 오디오 전처리 라이브러리다([AI_HARNESS.md](../../docs/v2/AI_HARNESS.md) §3.1–§3.3). Bun/Node API와 ffmpeg·ffprobe만 쓰고 다른 패키지를 import하지 않는다. 단계 정의, 메모이제이션, 산출물 저장은 `packages/harness`가 맡는다.

## 흐름

```ts
import {
  screenAudio, normalizeAudio, detectSilences, buildSpeechMap,
  renderSpeechAudio, planChunks, renderChunks, toOriginalMs, formatGapMarker,
} from "@lectern/media";

const screen = await screenAudio(upload);            // ingest: 형식·길이·creation_time·sha256 + 사전 거부
if (!screen.ok) throw stageError("input", screen.code, screen.message);

const norm = await normalizeAudio(upload, "work.flac"); // normalize: 모노 16kHz, -16 LUFS, 무손실 작업본
const map = buildSpeechMap(await detectSilences(norm.path, { durationMs: norm.duration_ms })); // speech_map
const speech = await renderSpeechAudio(norm.path, map.time_map, "speech.flac");

const plan = planChunks(map.cut_duration_ms, map.cut_silences, { targetMs: 6 * 60_000 }); // LLM: 5~8분
// 전용 STT: planChunks(map.cut_duration_ms, map.cut_silences, { targetMs: null }) → 통째로 한 청크
const manifest = await renderChunks(speech.path, plan, "chunks/"); // chunks.json (잘린 시간)

// merge에서 정확히 한 번: 청크 상대 시간 + 청크 시작 → 원본 시간
const startMs = toOriginalMs(chunk.start_ms + seg.start_ms, map.time_map);
const endMs = toOriginalMs(chunk.start_ms + seg.end_ms, map.time_map, "end");
map.cuts.map(formatGapMarker); // ["[쉬는 시간: 50:12~1:02:40]", "[종료 후: 1:12:15~1:20:00]"]
```

## 판정 규칙 (`DEFAULT_SPEECH_MAP_RULES`, `SPEECH_MAP_VERSION = 1`)

| 규칙 | 기본값 | 뜻 |
|---|---|---|
| `shortGapMs` | 2초 | 이보다 짧은 무음은 발화 안의 쉼이다. 자르지 않고 경계로도 쓰지 않는다 |
| `islandJoinMs` | 10초 | 이보다 가까운 발화는 한 덩어리(섬)다 |
| `anchorSpeechMs` | 20초 | 발화가 이만큼 이상인 섬이 "지속 발화"다. 자르는 구간의 경계는 지속 발화만 정한다 |
| `edgeKeepMs` | 30초 | 지속 발화 직후(직전) 이 거리 안에서 시작(끝)하는 섬은 함께 남긴다(마무리 한마디 보호) |
| `breakMinMs` | 5분 | 휴식(중간·앞부분)으로 자르는 최소 길이 |
| `tailMinMs` | 1분 | 마지막 지속 발화 뒤 꼬리를 자르는 최소 길이 |
| `maxCutSpeechRatio` | 0.1 | 발화가 구간의 10% 이하일 때만 자른다(산발적 소음 허용) |
| `cutPadMs` | 1.5초 | 지속 발화 옆에 남기는 무음 |

- 무음 검출: 정규화된 파일에 `silencedetect=noise=-35dB:d=2`(`SILENCE_DEFAULTS`). 소음이 큰 방(피크 SNR 약 22dB 이하)에서는 쉼이 -35dBFS를 넘어 아무것도 검출되지 않는다. 그러면 자르는 구간도 없다.
- 적응형 임계값(선택): `detectSilences(path, { noiseDb: "auto" })`. 100ms 창 피크 분포에서 임계값을 고른다(`AUTO_THRESHOLD_DEFAULTS`, `estimateSilenceThreshold`).
  - 바닥 = 5번째 백분위(-80dBFS 이하 디지털 무음 제외), 발화 = 95번째 백분위.
  - 임계값 = 바닥 + 6dB. 단 고정값(-35) 아래로 내리지 않고, -25dBFS와 발화 - 15dB를 넘기지 않는다.
  - 창이 50개 미만이거나 발화와 바닥의 차가 15dB 미만이면(쉼을 음량으로 구분할 수 없음) 고정값을 쓴다. 깨끗한 녹음에서는 고정값과 결과가 같다.
  - 결과의 `threshold`(`noise_db`, `adaptive`, `floor_db`, `speech_db`)를 로그와 메모 키에 넣는다. 평가 세트로 안전성을 확인하기 전까지 기본값은 고정값이다.
- 지속 발화가 하나도 없으면 아무것도 자르지 않는다.
- 사전 거부(`SCREEN_DEFAULTS`): 1초 미만·0바이트는 `empty`, 읽기 실패는 `corrupt`, 오디오 트랙 없음은 `no_audio_stream`, 허용 목록(`SUPPORTED_CODECS` + `pcm_*`·`adpcm_*`) 밖은 `unsupported_codec`, 최대 음량 -60dBFS 이하는 `silent`. 무음 판정은 전체 길이에 고르게 퍼진 12개 × 10초 표본으로 하고, 표본이 무음이면 전체 파일을 한 번 더 확인한 뒤에 거부한다.

## 불변식

- `speech_map`의 `cuts`·`kept`·`silences`·`speech`는 원본 시간이다. `time_map`·`cut_silences`·청크 매니페스트는 잘린 시간이다.
- 시간 맵은 잘린 시간에서 0부터 빈틈없이 이어지고, 원본 시간에서 겹치지 않고 증가한다(`validateTimeMap`).
- `toOriginalMs`는 잘린 오디오 끝을 넘는 시간을 마지막 보존 구간의 끝으로 자른다(공급자는 최대 1초 넘길 수 있다).
- 청크의 `core_*` 범위는 `[0, cut_duration_ms)`를 정확히 나눈다. 이음매(`seam_ms`)는 겹침 안의 무음에 놓인다.

## ffmpeg 요구 사항

ffmpeg·ffprobe 5.1 이상이 PATH에 있어야 한다. `alimiter`의 `latency` 옵션을 쓰기 때문이다. 확인: `ffmpeg -h filter=alimiter | grep latency`. 옵션이 없는 ffmpeg에서는 정규화가 실패한다(시간이 조용히 밀리지 않는다).

## 테스트

`bun test packages/media`. ffmpeg 통합 테스트는 `-f lavfi` 합성 오디오만 쓰고, ffmpeg가 없으면 건너뛴다.
