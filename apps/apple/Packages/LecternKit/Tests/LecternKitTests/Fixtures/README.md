# LecternKit 테스트 픽스처

`packages/domain/test/fixtures.ts`의 유효한 예시(`API_CASES`)를 JSON으로 뽑은 것이다. 저장소 루트에서 다시 뽑는다:

```bash
bun -e 'import { API_CASES as C } from "./packages/domain/test/fixtures.ts"; const o = "apps/apple/Packages/LecternKit/Tests/LecternKitTests/Fixtures"; for (const [n, v] of Object.entries({ "recording-page.json": C.RecordingPage.valid[2], "recording-detail.json": C.RecordingDetail.valid[0], "transcript.json": C.Transcript.valid[0], "document.json": C.DocumentWithVersion.valid[0], "me.json": C.Me.valid[0], "error-not-found.json": C.ApiError.valid[0] })) await Bun.write(`${o}/${n}`, JSON.stringify(v, null, 2) + "\n")'
```

다시 뽑은 뒤 손으로 고치는 것(열린 유니온 테스트용):

- `document.json`: 둘째 섹션 끝에 모르는 블록 `{"type": "future_block", "x": 1}`, 첫 블록의 `sources` 끝에 모르는 출처 `{"kind": "video_frame", "at_ms": 1000}`.
- `error-quota.json`은 손으로 쓴 것이다(`quota_exceeded` 본문).
