import { defineConfig } from "drizzle-kit";

// `bun run --cwd packages/db generate` writes a new SQL migration for schema.ts changes.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
});
