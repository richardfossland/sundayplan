#!/usr/bin/env node
/**
 * Production smoke for plan.sundaysuite.app — curl-level, no credentials.
 * Run after every deploy: `node scripts/smoke-prod.mjs [base-url]`.
 */
const BASE = process.argv[2] ?? "https://plan.sundaysuite.app";

let failed = 0;

async function check(name, path, opts, expect) {
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual", ...opts });
    const body = await res.text();
    const problems = [];
    if (expect.status && res.status !== expect.status) {
      problems.push(`status ${res.status} (want ${expect.status})`);
    }
    if (expect.contains && !body.includes(expect.contains)) {
      problems.push(`body missing "${expect.contains}"`);
    }
    if (expect.redirectsTo && !(res.headers.get("location") ?? "").includes(expect.redirectsTo)) {
      problems.push(`location ${res.headers.get("location")} (want *${expect.redirectsTo}*)`);
    }
    if (problems.length) {
      failed++;
      console.error(`✗ ${name}: ${problems.join("; ")}`);
    } else {
      console.log(`✓ ${name}`);
    }
  } catch (e) {
    failed++;
    console.error(`✗ ${name}: ${e.message}`);
  }
}

await check("root redirects to sign-in (unauthenticated)", "/", {}, {
  status: 307,
  redirectsTo: "/sign-in",
});
await check("sign-in renders (default Norwegian)", "/sign-in", {}, {
  status: 200,
  contains: "Velkommen tilbake",
});
await check("sign-in localizes via Accept-Language (de)", "/sign-in", {
  headers: { "Accept-Language": "de-DE" },
}, { status: 200, contains: "Willkommen zur" });
await check("volunteer RSVP route is public (invalid token → friendly error)", "/r/smoke-invalid-token", {}, {
  status: 200,
  contains: "SundayPlan",
});
// The auth middleware bounces unauthenticated requests before the handler's
// own 401 — either way, no data leaves without a session.
await check("data export requires a session", "/api/export", {}, {
  status: 307,
  redirectsTo: "/sign-in",
});
await check("app pages gate to sign-in", "/people", {}, {
  status: 307,
  redirectsTo: "/sign-in",
});

if (failed) {
  console.error(`\n${failed} smoke check(s) FAILED`);
  process.exit(1);
}
console.log("\n✓ all prod smoke checks passed");
