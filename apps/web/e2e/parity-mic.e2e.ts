// v1 screen parity on the fixture build (docs/v2/pipeline/PARITY.md): recording from
// the browser microphone with pause and resume. Chromium's fake media device stands in for
// a microphone; launch options apply to the whole file, so it has a file of its own.

import { expect, test } from "./fixtures.ts";

test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

test("microphone: record, pause, resume and finish adds the file to the upload list", async ({ page, axe }) => {
  // Headless Chromium refuses the Screen Wake Lock, so a stand-in records what the
  // recorder asks for, the way the fake media device stands in for a microphone.
  await page.addInitScript(() => {
    const counts = { requested: 0, released: 0 };
    class FakeSentinel extends EventTarget {
      released = false;
      constructor(readonly type: string) {
        super();
      }
      async release() {
        if (this.released) return;
        this.released = true;
        counts.released++;
        this.dispatchEvent(new Event("release"));
      }
    }
    Object.defineProperty(window, "__wakeLocks", { value: counts });
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async (type: string) => {
          counts.requested++;
          return new FakeSentinel(type);
        },
      },
    });
  });
  const wakeLocks = () => page.evaluate(() => (window as unknown as { __wakeLocks: { requested: number; released: number } }).__wakeLocks);
  await page.goto("/app/library");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.locator("body").press("u");
  const dialog = page.getByRole("dialog", { name: "녹음 올리기" });
  const recorder = dialog.getByRole("region", { name: "브라우저 마이크 녹음" });
  await recorder.getByRole("button", { name: "마이크 녹음 시작" }).click();
  await expect(recorder.getByText(/^녹음 중 · /)).toBeVisible();
  // The screen stays on while recording (Screen Wake Lock).
  await expect(recorder.getByText("절전 방지 켜짐")).toBeVisible();
  expect((await wakeLocks()).requested).toBeGreaterThanOrEqual(1);
  await axe(page, "마이크 녹음 중");
  await recorder.getByRole("button", { name: "일시정지" }).click();
  await expect(recorder.getByText(/^일시정지 · /)).toBeVisible();
  await recorder.getByRole("button", { name: "재개" }).click();
  await expect(recorder.getByText(/^녹음 중 · /)).toBeVisible();
  // Long enough for MediaRecorder's one-second chunks to hold some audio.
  await page.waitForTimeout(1_500);
  await recorder.getByRole("button", { name: "녹음 완료" }).click();
  await expect(recorder.getByText("마이크로 바로 녹음")).toBeVisible();
  const locks = await wakeLocks();
  expect(locks.released).toBe(locks.requested);
  await expect(dialog.getByText(/강의녹음_.*\.(webm|ogg|m4a|mp4)/).first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "녹음 1개 올리기" })).toBeEnabled();
});
