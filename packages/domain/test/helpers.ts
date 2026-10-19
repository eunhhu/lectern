import { expect } from "bun:test";
import type { z } from "zod";

/** Keys of an object schema that reject `undefined`. Empty for non-object schemas. */
export function requiredKeys(schema: z.ZodType): string[] {
  const shape = (schema as unknown as { shape?: Record<string, z.ZodType> }).shape;
  if (!shape) return [];
  return Object.entries(shape)
    .filter(([, field]) => !field.safeParse(undefined).success)
    .map(([key]) => key);
}

export function expectValid(schema: z.ZodType, value: unknown, label: string): void {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label}: expected valid, got ${JSON.stringify(result.error.issues, null, 2)}`);
  }
}

export function expectInvalid(schema: z.ZodType, value: unknown, label: string): void {
  const result = schema.safeParse(value);
  expect(result.success, `${label}: expected invalid: ${JSON.stringify(value)}`).toBe(false);
}

/** Every valid fixture minus one required key must fail. */
export function expectRequiredKeysEnforced(schema: z.ZodType, valid: unknown, label: string): number {
  if (typeof valid !== "object" || valid === null) return 0;
  let checked = 0;
  for (const key of requiredKeys(schema)) {
    if (!(key in valid)) continue;
    const { [key]: _dropped, ...rest } = valid as Record<string, unknown>;
    expectInvalid(schema, rest, `${label} without ${key}`);
    checked++;
  }
  return checked;
}
