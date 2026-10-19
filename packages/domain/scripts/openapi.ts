// Writes packages/domain/openapi.json. Run with `bun run domain:openapi`.
import { join } from "node:path";
import { serializeOpenApi } from "../src/openapi.ts";

const target = join(import.meta.dir, "..", "openapi.json");
await Bun.write(target, serializeOpenApi());
console.log(`wrote ${target}`);
