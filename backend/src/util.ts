import { createHash } from "node:crypto";

export function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function digest(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

export function deterministicId(prefix: string, ...parts: unknown[]): string {
  return `${prefix}_${digest(parts).slice(0, 16)}`;
}

export function getAtPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, root);
}

export function setAtPath(root: unknown, path: string, value: unknown): void {
  const segments = path.split(".");
  const last = segments.pop();
  if (!last) throw new Error("path cannot be empty");
  let current = root as Record<string, unknown>;
  for (const segment of segments) {
    const next = current[segment];
    if (next === null || typeof next !== "object") throw new Error(`invalid intervention path: ${path}`);
    current = next as Record<string, unknown>;
  }
  current[last] = value;
}
