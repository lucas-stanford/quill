/**
 * The small validation primitives shared by anything that reads JSON written
 * by somebody else — the browser, or a parent agent's shell script.
 *
 * Every failure names the offending field, because the other half of the agent
 * bridge is implemented by a human against a text file: "body.brief.edits[1].kind
 * must be \"insertion\" or \"deletion\"" is a bug report, "invalid request" is a
 * guessing game.
 */

export class ShapeError extends Error {}

export function fail(message: string): never {
  throw new ShapeError(message);
}

/** Runs a validator, turning a ShapeError into a result instead of a throw. */
export function collectShapeErrors<T>(
  read: () => T,
): { ok: true; value: T } | { ok: false; reason: string } {
  try {
    return { ok: true, value: read() };
  } catch (err) {
    if (err instanceof ShapeError) return { ok: false, reason: err.message };
    throw err;
  }
}

export function requireRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, where: string): string {
  if (typeof value !== "string") fail(`${where} must be a string`);
  return value;
}

/** A string that may be absent — absent becomes `fallback`, wrong type still fails. */
export function optionalString(value: unknown, where: string, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  return requireString(value, where);
}

export function optionalBoolean(value: unknown, where: string, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") fail(`${where} must be a boolean`);
  return value;
}

export function requireArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(`${where} must be an array`);
  return value;
}

export function optionalArray(value: unknown, where: string): unknown[] {
  if (value === undefined || value === null) return [];
  return requireArray(value, where);
}
