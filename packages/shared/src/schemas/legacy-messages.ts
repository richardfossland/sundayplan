/**
 * Zod 4 reworded every built-in validation message. Several server actions show
 * `issues[0].message` straight to the planner, so we pin the English wording to
 * what Zod 3 produced and keep the user-facing text unchanged across the major
 * bump. Anything not mapped here falls through to Zod 4's own message.
 *
 * Installed once, as a side effect of importing `./index` (see `schemas/index.ts`).
 */
import { z } from "zod";

function receivedType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number" && Number.isNaN(v)) return "nan";
  return typeof v;
}

type Issue = {
  code: string;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  inclusive?: boolean;
  format?: string;
  expected?: string;
  values?: unknown[];
  input?: unknown;
};

export function legacyMessage(iss: Issue): string | undefined {
  switch (iss.code) {
    case "invalid_type":
      return iss.input === undefined
        ? "Required"
        : `Expected ${iss.expected}, received ${receivedType(iss.input)}`;
    case "too_small": {
      const n = String(iss.minimum);
      if (iss.origin === "string") return `String must contain ${iss.inclusive ? "at least" : "over"} ${n} character(s)`;
      if (iss.origin === "array") return `Array must contain ${iss.inclusive ? "at least" : "more than"} ${n} element(s)`;
      if (iss.origin === "number") return `Number must be ${iss.inclusive ? "greater than or equal to" : "greater than"} ${n}`;
      return undefined;
    }
    case "too_big": {
      const n = String(iss.maximum);
      if (iss.origin === "string") return `String must contain ${iss.inclusive ? "at most" : "under"} ${n} character(s)`;
      if (iss.origin === "array") return `Array must contain ${iss.inclusive ? "at most" : "less than"} ${n} element(s)`;
      if (iss.origin === "number") return `Number must be ${iss.inclusive ? "less than or equal to" : "less than"} ${n}`;
      return undefined;
    }
    case "invalid_value": {
      const values = iss.values ?? [];
      if (values.length === 1) return `Invalid literal value, expected ${JSON.stringify(values[0])}`;
      return `Invalid enum value. Expected ${values.map((v) => `'${String(v)}'`).join(" | ")}, received '${String(iss.input)}'`;
    }
    case "invalid_format":
      if (iss.format === "email") return "Invalid email";
      if (iss.format === "url") return "Invalid url";
      if (iss.format === "datetime") return "Invalid datetime";
      if (iss.format === "regex") return "Invalid";
      return undefined;
    case "invalid_union":
      return "Invalid input";
    default:
      return undefined;
  }
}

z.config({ customError: (iss) => legacyMessage(iss as Issue) });
