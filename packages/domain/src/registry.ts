import type { z } from "zod";

export interface NamedSchema {
  id: string;
  schema: z.ZodType;
}

const namedSchemas: NamedSchema[] = [];
const namedIds = new Set<string>();

/**
 * Publishes `schema` as the OpenAPI component `id` and returns it.
 *
 * Every request/response body and every reusable building block of the API
 * (ids, timestamps, enums) goes through here, so generated Swift/Kotlin
 * clients get named types and `$ref`s instead of inlined copies. Harness-only
 * schemas (model outputs) are deliberately not named: they are not part of the
 * HTTP contract.
 *
 * The description is attached with `.describe()` so it lands in the global
 * metadata registry that `z.toJSONSchema` reads.
 */
export function named<T extends z.ZodType>(id: string, schema: T, description?: string): T {
  if (namedIds.has(id)) throw new Error(`duplicate schema id: ${id}`);
  const described = description ? schema.describe(description) : schema;
  namedIds.add(id);
  namedSchemas.push({ id, schema: described });
  return described;
}

/** All published schemas in declaration order. */
export function listNamedSchemas(): readonly NamedSchema[] {
  return namedSchemas;
}

/** The component id `schema` was published under, if any. */
export function namedIdOf(schema: z.ZodType): string | undefined {
  return namedSchemas.find((entry) => entry.schema === schema)?.id;
}
