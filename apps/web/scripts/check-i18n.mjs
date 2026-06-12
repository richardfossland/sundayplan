#!/usr/bin/env node
/**
 * i18n key-parity gate (wired into `npm run check`).
 *
 * Every locale catalog must mirror catalogs/en.ts key-for-key: missing keys
 * would silently fall back to English in production, extra keys are dead
 * weight that drifts. Also rejects duplicate keys within a catalog (later
 * duplicates silently win in object literals).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "i18n", "catalogs");
const REQUIRED = ["no", "en", "sv", "da", "de", "fr", "pl"];

function keysOf(file) {
  const src = readFileSync(join(dir, file), "utf8");
  // Match object-literal entries: lines starting with a quoted dotted key.
  const keys = [...src.matchAll(/^\s*"([^"\n]+)":/gm)].map((m) => m[1]);
  return keys;
}

const present = readdirSync(dir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.replace(/\.ts$/, ""));

let failed = false;

for (const locale of REQUIRED) {
  if (!present.includes(locale)) {
    console.error(`✗ missing catalog: catalogs/${locale}.ts`);
    failed = true;
  }
}

const enKeys = keysOf("en.ts");
const enSet = new Set(enKeys);
const dupEn = enKeys.filter((k, i) => enKeys.indexOf(k) !== i);
if (dupEn.length) {
  console.error(`✗ en.ts has duplicate keys: ${[...new Set(dupEn)].join(", ")}`);
  failed = true;
}

for (const locale of present.filter((l) => l !== "en" && REQUIRED.includes(l))) {
  const keys = keysOf(`${locale}.ts`);
  const set = new Set(keys);
  const dups = keys.filter((k, i) => keys.indexOf(k) !== i);
  const missing = enKeys.filter((k) => !set.has(k));
  const extra = keys.filter((k) => !enSet.has(k));
  if (dups.length) {
    console.error(`✗ ${locale}.ts duplicate keys: ${[...new Set(dups)].join(", ")}`);
    failed = true;
  }
  if (missing.length) {
    console.error(`✗ ${locale}.ts missing ${missing.length} key(s): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", …" : ""}`);
    failed = true;
  }
  if (extra.length) {
    console.error(`✗ ${locale}.ts extra ${extra.length} key(s): ${extra.slice(0, 10).join(", ")}${extra.length > 10 ? ", …" : ""}`);
    failed = true;
  }
  if (!dups.length && !missing.length && !extra.length) {
    console.log(`✓ ${locale}.ts — ${keys.length} keys, full parity`);
  }
}

if (failed) {
  process.exit(1);
}
console.log(`✓ i18n parity OK (${enKeys.length} keys × ${present.length} locales)`);
