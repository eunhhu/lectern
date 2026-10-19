// @lectern/domain: the v2 schema single source of truth (ARCHITECTURE §4, §5, §6).
// Runtime dependency: zod only. Never import another workspace package here.

export * from "./registry.ts";
export * from "./primitives.ts";
export * from "./enums.ts";
export * from "./blocks.ts";
export * from "./entities.ts";
export * from "./harness.ts";
export * from "./templates.ts";
export * from "./api/common.ts";
export * from "./api/uploads.ts";
export * from "./api/events.ts";
export * from "./api/resources.ts";
export * from "./api/routes.ts";
export { buildOpenApiDocument, componentSchemas, serializeOpenApi, SESSION_COOKIE } from "./openapi.ts";
