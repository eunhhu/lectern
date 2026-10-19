// `bun run web:dev`: a development build, rebuilt when src/ changes, served by the
// preview server. Reload the page after a rebuild (no live-reload script, so the page
// stays under the same CSP as production).

import { watch } from "node:fs";
import { join } from "node:path";
import { WEB_ROOT, buildWeb } from "./build.ts";
import { startPreviewServer } from "./serve.ts";

const portArg = process.argv.indexOf("--port");
await buildWeb({ dev: true });
startPreviewServer({ port: portArg > 0 ? Number(process.argv[portArg + 1]) : undefined });

let timer: ReturnType<typeof setTimeout> | undefined;
let building: Promise<unknown> = Promise.resolve();
watch(join(WEB_ROOT, "src"), { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    building = building.then(() => buildWeb({ dev: true }).catch((err) => console.error(err)));
  }, 80);
});
console.log("web: watching src/ for changes");
