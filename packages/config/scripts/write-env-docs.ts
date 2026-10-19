// Regenerates docs/env.md from the schema in src/index.ts: `bun run config:docs`.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, describeEnv } from "../src/index.ts";

const out = join(REPO_ROOT, "docs/env.md");
writeFileSync(
  out,
  `# 환경 변수 레퍼런스\n\n> 자동 생성 파일입니다. \`packages/config/src/index.ts\`를 고친 뒤 \`bun run config:docs\`로 다시 만드세요.\n\n${describeEnv()}\n`
);
console.log(`wrote ${out}`);
