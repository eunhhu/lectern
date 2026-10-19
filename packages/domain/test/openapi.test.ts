import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildOpenApiDocument, componentSchemas, listNamedSchemas, ROUTES, serializeOpenApi } from "../src/index.ts";

const OPENAPI_PATH = join(import.meta.dir, "..", "openapi.json");

type Json = Record<string, unknown>;

function walk(value: unknown, visit: (node: Json) => void): void {
  if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
  else if (value && typeof value === "object") {
    visit(value as Json);
    Object.values(value).forEach((child) => walk(child, visit));
  }
}

function stripClosedObjects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripClosedObjects);
  if (!value || typeof value !== "object") return value;
  const out: Json = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "additionalProperties" && child === false) continue;
    out[key] = stripClosedObjects(child);
  }
  return out;
}

describe("openapi.json", () => {
  test("is up to date (run `bun run domain:openapi` if this fails)", () => {
    expect(readFileSync(OPENAPI_PATH, "utf8")).toBe(serializeOpenApi());
  });

  test("generation is deterministic", () => {
    expect(serializeOpenApi(buildOpenApiDocument())).toBe(serializeOpenApi(buildOpenApiDocument()));
  });

  const doc = buildOpenApiDocument() as {
    openapi: string;
    paths: Record<string, Record<string, Json>>;
    components: { schemas: Record<string, Json>; responses: Record<string, Json> };
  };

  test("is OpenAPI 3.1 with one operation per route", () => {
    expect(doc.openapi).toBe("3.1.0");
    const operations = Object.values(doc.paths).flatMap((methods) => Object.values(methods));
    expect(operations.length).toBe(ROUTES.length);
    expect(new Set(operations.map((op) => op.operationId)).size).toBe(ROUTES.length);
  });

  test("every $ref resolves", () => {
    const missing: string[] = [];
    walk(doc, (node) => {
      if (typeof node.$ref !== "string") return;
      const [, section, name] = node.$ref.match(/^#\/components\/(schemas|responses)\/(.+)$/) ?? [];
      const table = section === "schemas" ? doc.components.schemas : section === "responses" ? doc.components.responses : undefined;
      if (!table || !name || !(name in table)) missing.push(node.$ref);
    });
    expect(missing).toEqual([]);
  });

  test("publishes every named schema and nothing internal", () => {
    expect(Object.keys(doc.components.schemas).sort()).toEqual(listNamedSchemas().map((s) => s.id).sort());
    walk(doc.components.schemas, (node) => {
      expect(node).not.toHaveProperty("$id");
      expect(node).not.toHaveProperty("$schema");
    });
    const text = serializeOpenApi(doc);
    for (const secret of ["token_hash", "password_hash", "refresh_hash", "token_enc", "blob_key", "ip_hash"]) {
      expect(text.includes(`"${secret}"`), secret).toBe(false);
    }
  });

  test("objects stay open for additive changes", () => {
    walk(doc, (node) => expect(node.additionalProperties).not.toBe(false));
  });

  test("request and response shapes agree (no defaults or transforms in published schemas)", () => {
    expect(stripClosedObjects(componentSchemas("output"))).toEqual(componentSchemas("input"));
  });

  test("discriminated unions carry a discriminator", () => {
    const { ServerEvent, DocumentBlock, SearchHit, SourceRef } = doc.components.schemas;
    expect(ServerEvent!.discriminator).toMatchObject({ propertyName: "type" });
    expect((ServerEvent!.discriminator as { mapping: Json }).mapping["job.progress"]).toBe(
      "#/components/schemas/JobProgressEvent",
    );
    expect(DocumentBlock!.discriminator).toMatchObject({ propertyName: "type" });
    expect(SearchHit!.discriminator).toMatchObject({ propertyName: "kind" });
    expect(SourceRef!.discriminator).toEqual({ propertyName: "kind" });
  });

  test("the upload flow and SSE are described", () => {
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/uploads", "/uploads/{upload_id}/parts/{part}", "/uploads/{upload_id}/complete", "/events"]),
    );
    const put = doc.paths["/uploads/{upload_id}/parts/{part}"]!.put as { requestBody: { content: Json } };
    expect(Object.keys(put.requestBody.content)).toEqual(["application/octet-stream"]);
    const sse = doc.paths["/events"]!.get as { responses: Record<string, { content: Json }> };
    expect(Object.keys(sse.responses["200"]!.content)).toEqual(["text/event-stream"]);
    const create = doc.components.schemas.CreateUploadRequest as { properties: Json; required: string[] };
    expect(create.properties).toHaveProperty("recorded_at");
    expect(create.required).not.toContain("recorded_at");
  });
});
