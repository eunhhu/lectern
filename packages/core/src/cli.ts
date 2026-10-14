#!/usr/bin/env bun
import { resolve, extname, dirname, basename, join } from "node:path";
import { writeFileSync } from "node:fs";
import { distillLectureAudio, DEFAULT_GEMINI_MODEL } from "./gemini.ts";

function printHelp() {
  console.log(`Usage: lectern <audio_file> [options]

Zero-overhead lecture audio distillation CLI (powered by Bun + Gemini Flash)

Arguments:
  audio_file             Path to lecture recording (.m4a, .mp3, .wav, .webm, .ogg)

Options:
  -c, --course <name>    Course name (default: "대학교 전공 강의")
  -m, --model <id>       Gemini model ID (default: "${DEFAULT_GEMINI_MODEL}")
  -o, --output <path>    Output markdown path (default: <audio_file>_요약.md)
  -k, --key <api_key>    Explicit GEMINI_API_KEY override
  -h, --help             Show this help message
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }

  let audioFile = "";
  let courseName = "대학교 전공 강의";
  let model = DEFAULT_GEMINI_MODEL;
  let outputPath = "";
  let apiKey: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === "-c" || a === "--course") && args[i + 1]) {
      courseName = args[++i];
    } else if ((a === "-m" || a === "--model") && args[i + 1]) {
      model = args[++i];
    } else if ((a === "-o" || a === "--output") && args[i + 1]) {
      outputPath = args[++i];
    } else if ((a === "-k" || a === "--key") && args[i + 1]) {
      apiKey = args[++i];
    } else if (!a.startsWith("-") && !audioFile) {
      audioFile = a;
    }
  }

  if (!audioFile) {
    console.error("❌ 오디오 파일 경로를 지정해주세요.");
    process.exit(1);
  }

  const absAudio = resolve(audioFile);
  const ext = extname(absAudio);
  const baseNoExt = join(dirname(absAudio), basename(absAudio, ext));
  const finalOut = outputPath ? resolve(outputPath) : `${baseNoExt}_요약.md`;

  const res = await distillLectureAudio({
    audioPath: absAudio,
    courseName,
    model,
    apiKey,
    onProgress: (ev) => {
      console.log(`[${ev.stage.toUpperCase()}] ${ev.message}`);
    },
  });

  writeFileSync(finalOut, res.markdown + "\n", "utf8");
  console.log(`\n🎉 강의 노트 저장 완료! (${res.modelUsed})\n📄 경로: ${finalOut}`);
}

main().catch((err) => {
  console.error("❌ 오류 발생:", err?.message || err);
  process.exit(1);
});
