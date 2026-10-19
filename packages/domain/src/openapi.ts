import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { ApiError } from "./api/common.ts";
import { API_BASE_PATH, ROUTES, type RouteDef, type RouteResponse } from "./api/routes.ts";
import { listNamedSchemas, namedIdOf } from "./registry.ts";

// Builds openapi.json (OpenAPI 3.1, JSON Schema 2020-12) from the route table
// and the published schemas. Output must be deterministic: the staleness test
// compares it byte for byte with the committed file.

type Json = Record<string, unknown>;

const REF_PREFIX = "#/components/schemas/";
export const SESSION_COOKIE = "lectern_session";

/** Shared error responses, published under components.responses. */
const ERROR_RESPONSES: Record<number, { name: string; description: string }> = {
  400: { name: "BadRequest", description: "Bad request or validation failed." },
  401: { name: "Unauthorized", description: "Not signed in." },
  403: { name: "Forbidden", description: "Not allowed in this workspace." },
  404: { name: "NotFound", description: "Not found." },
  409: { name: "Conflict", description: "Conflicts with the current state." },
  412: { name: "PreconditionFailed", description: "If-Match does not match the current version." },
  413: { name: "PayloadTooLarge", description: "Too large." },
  415: { name: "UnsupportedMediaType", description: "Unsupported media type." },
  416: { name: "RangeNotSatisfiable", description: "Range not satisfiable." },
  428: { name: "PreconditionRequired", description: "If-Match is required." },
  429: { name: "TooManyRequests", description: "Rate limited or quota exceeded." },
};
const DEFAULT_ERROR = { name: "UnexpectedError", description: "Unexpected error." };

const ref = (id: string): Json => ({ $ref: REF_PREFIX + id });

function requireNamed(schema: z.ZodType, where: string): string {
  const id = namedIdOf(schema);
  if (!id) throw new Error(`${where}: body schemas must be published with named()`);
  return id;
}

/** Converts every published schema to JSON Schema in one pass so `$ref`s line up. */
function convertAll(extra: Map<string, z.ZodType>, io: "input" | "output" = "input"): Record<string, Json> {
  const registry = z.registry<{ id: string }>();
  for (const { id, schema } of listNamedSchemas()) registry.add(schema, { id });
  for (const [id, schema] of extra) registry.add(schema, { id });
  const { schemas } = z.toJSONSchema(registry, {
    target: "draft-2020-12",
    io,
    unrepresentable: "throw",
    uri: (id) => REF_PREFIX + id,
  });
  const out: Record<string, Json> = {};
  for (const [id, schema] of Object.entries(schemas)) {
    const { $schema: _schema, $id: _id, ...rest } = schema as Json;
    out[id] = rest;
  }
  return out;
}

/** JSON Schema for every published schema, keyed by component id. Exposed for tests. */
export function componentSchemas(io: "input" | "output" = "input"): Record<string, Json> {
  return convertAll(new Map(), io);
}

function addDiscriminators(components: Record<string, Json>): void {
  for (const { id, schema } of listNamedSchemas()) {
    const discriminator = (schema as unknown as { _zod: { def: { discriminator?: string } } })._zod.def.discriminator;
    const component = components[id];
    if (!discriminator || !component || !Array.isArray(component.oneOf)) continue;
    const mapping: Record<string, string> = {};
    for (const option of component.oneOf as Json[]) {
      const target = typeof option.$ref === "string" ? option.$ref.slice(REF_PREFIX.length) : undefined;
      const value = target
        ? ((components[target]?.properties as Json | undefined)?.[discriminator] as Json | undefined)?.const
        : undefined;
      if (typeof value !== "string") {
        component.discriminator = { propertyName: discriminator };
        break;
      }
      mapping[value] = option.$ref as string;
    }
    if (!component.discriminator) component.discriminator = { propertyName: discriminator, mapping };
  }
}

type Location = "path" | "query" | "header";

function routeLocations(route: RouteDef): Array<[Location, z.ZodObject]> {
  const out: Array<[Location, z.ZodObject]> = [];
  if (route.params) out.push(["path", route.params]);
  if (route.query) out.push(["query", route.query]);
  if (route.headers) out.push(["header", route.headers]);
  return out;
}

function errorResponse(description: string): Json {
  return { description, content: { "application/json": { schema: ref(requireNamed(ApiError, "ApiError")) } } };
}

function binarySchema(contentType: string): Json {
  return { type: "string", contentMediaType: contentType };
}

export function buildOpenApiDocument(routes: readonly RouteDef[] = ROUTES): Json {
  // Parameters and response headers are converted in the same pass as the
  // components, each through a fresh wrapper object, then inlined.
  const extra = new Map<string, z.ZodType>();
  const paramKey = (i: number, loc: string) => `__route${i}_${loc}`;
  const headerKey = (i: number, status: number) => `__route${i}_response${status}_headers`;
  routes.forEach((route, i) => {
    for (const [loc, shape] of routeLocations(route)) extra.set(paramKey(i, loc), z.object(shape.shape));
    for (const [status, response] of Object.entries(route.responses)) {
      if (!response.headers) continue;
      const shape = Object.fromEntries(Object.entries(response.headers).map(([name, h]) => [name, h.schema]));
      extra.set(headerKey(i, Number(status)), z.object(shape));
    }
  });

  const converted = convertAll(extra);
  const components: Record<string, Json> = {};
  for (const id of Object.keys(converted).sort()) {
    if (!extra.has(id)) components[id] = converted[id]!;
  }
  addDiscriminators(components);

  const paths: Record<string, Record<string, Json>> = {};
  const operationIds = new Set<string>();
  const tags: string[] = [];

  routes.forEach((route, i) => {
    if (operationIds.has(route.operationId)) throw new Error(`duplicate operationId ${route.operationId}`);
    operationIds.add(route.operationId);
    if (!tags.includes(route.tag)) tags.push(route.tag);

    const parameters: Json[] = [];
    for (const [loc] of routeLocations(route)) {
      const wrapper = converted[paramKey(i, loc)]!;
      const required = new Set((wrapper.required as string[] | undefined) ?? []);
      for (const [name, prop] of Object.entries(wrapper.properties as Record<string, Json>)) {
        const { description, ...schema } = prop;
        parameters.push({
          name,
          in: loc,
          required: loc === "path" || required.has(name),
          ...(description ? { description } : {}),
          schema,
        });
      }
    }
    const pathParams = [...route.path.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
    const declared = parameters.filter((p) => p.in === "path").map((p) => p.name);
    if (pathParams.join() !== declared.join()) {
      throw new Error(`${route.operationId}: path params ${pathParams} do not match declared ${declared}`);
    }

    const operation: Json = {
      operationId: route.operationId,
      summary: route.summary,
      tags: [route.tag],
    };
    if (route.public) operation.security = [];
    if (parameters.length > 0) operation.parameters = parameters;

    if (route.body) {
      const contentType = route.body.contentType ?? "application/json";
      const schema =
        "schema" in route.body
          ? ref(requireNamed(route.body.schema, route.operationId))
          : binarySchema(contentType);
      operation.requestBody = { required: true, content: { [contentType]: { schema } } };
    }

    const responses: Record<string, Json> = {};
    for (const [status, response] of Object.entries(route.responses) as Array<[string, RouteResponse]>) {
      const out: Json = { description: response.description };
      if (response.headers) {
        const wrapper = converted[headerKey(i, Number(status))]!;
        out.headers = Object.fromEntries(
          Object.entries(wrapper.properties as Record<string, Json>).map(([name, schema]) => [
            name,
            { description: response.headers![name]!.description, schema },
          ]),
        );
      }
      const contentType = response.contentType ?? (response.schema ? "application/json" : undefined);
      if (contentType) {
        const schema = response.schema
          ? ref(requireNamed(response.schema, route.operationId))
          : binarySchema(contentType);
        out.content = { [contentType]: { schema } };
      }
      responses[status] = out;
    }
    const errors = new Set(route.errors ?? []);
    if (!route.public) errors.add(401);
    for (const status of [...errors].sort((a, b) => a - b)) {
      const error = ERROR_RESPONSES[status];
      if (!error) throw new Error(`${route.operationId}: no shared error response for ${status}`);
      responses[String(status)] = { $ref: `#/components/responses/${error.name}` };
    }
    responses.default = { $ref: `#/components/responses/${DEFAULT_ERROR.name}` };
    operation.responses = responses;

    (paths[route.path] ??= {})[route.method] = operation;
  });

  return {
    openapi: "3.1.0",
    info: {
      title: "Lectern API",
      version: pkg.version,
      description:
        "Generated from packages/domain by `bun run domain:openapi`. Do not edit by hand. Unknown fields and unknown values of open enums/unions must be ignored by clients (see packages/domain/README.md).",
    },
    servers: [{ url: API_BASE_PATH }],
    security: [{ session: [] }, { bearer: [] }],
    tags: tags.map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: SESSION_COOKIE, description: "Web session cookie." },
        bearer: {
          type: "http",
          scheme: "bearer",
          description: "Native access token or personal access token.",
        },
      },
      responses: Object.fromEntries(
        [...Object.values(ERROR_RESPONSES), DEFAULT_ERROR].map(({ name, description }) => [
          name,
          errorResponse(description),
        ]),
      ),
      schemas: components,
    },
  };
}

export function serializeOpenApi(document: Json = buildOpenApiDocument()): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
