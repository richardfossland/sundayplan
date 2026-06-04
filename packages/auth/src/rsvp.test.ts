import { describe, expect, it } from "vitest";
import {
  applyResponse,
  buildResponseLinks,
  consumeSingleUseLink,
  isRespondable,
  parseAction,
  RSVP_ACTIONS,
} from "./rsvp";
import { signMagicLink } from "./magic-link";

describe("parseAction", () => {
  it("accepts the two valid actions", () => {
    expect(parseAction("accept")).toBe("accept");
    expect(parseAction("decline")).toBe("decline");
  });

  it("rejects anything else", () => {
    expect(parseAction(null)).toBeNull();
    expect(parseAction(undefined)).toBeNull();
    expect(parseAction("")).toBeNull();
    expect(parseAction("ACCEPT")).toBeNull();
    expect(parseAction("suggest_swap")).toBeNull();
    expect(parseAction("yes")).toBeNull();
  });

  it("exposes the canonical action list", () => {
    expect([...RSVP_ACTIONS]).toEqual(["accept", "decline"]);
  });
});

describe("buildResponseLinks", () => {
  it("builds view/accept/decline URLs around the token", () => {
    const links = buildResponseLinks("https://plan.example.com", "tok123");
    expect(links.view_link).toBe("https://plan.example.com/r/tok123");
    expect(links.accept_link).toBe("https://plan.example.com/r/tok123?do=accept");
    expect(links.decline_link).toBe("https://plan.example.com/r/tok123?do=decline");
  });

  it("trims trailing slashes from the base URL", () => {
    const links = buildResponseLinks("https://plan.example.com///", "tok");
    expect(links.view_link).toBe("https://plan.example.com/r/tok");
  });

  it("url-encodes the token (JWTs are dot-separated but path-safe; encode defensively)", () => {
    const links = buildResponseLinks("https://x.test", "a/b+c=d");
    expect(links.accept_link).toBe("https://x.test/r/a%2Fb%2Bc%3Dd?do=accept");
  });

  it("produces a link from a real signed token that survives a round-trip path", async () => {
    const token = await signMagicLink(
      {
        member_id: "11111111-1111-4111-8111-111111111111",
        church_id: "22222222-2222-4222-8222-222222222222",
        purpose: "assignment_response",
        assignment_id: "33333333-3333-4333-8333-333333333333",
        ttl_seconds: 604800,
        now: 1_700_000_000,
        jti: "fixed",
      },
      "secret",
    );
    const links = buildResponseLinks("https://x.test", token);
    // The token round-trips out of the encoded URL unchanged.
    const encoded = links.accept_link.slice("https://x.test/r/".length, -"?do=accept".length);
    expect(decodeURIComponent(encoded)).toBe(token);
  });
});

describe("isRespondable", () => {
  it("is true for every status except removed", () => {
    for (const s of ["pending", "invited", "accepted", "declined", "no_response"] as const) {
      expect(isRespondable(s)).toBe(true);
    }
    expect(isRespondable("removed")).toBe(false);
  });
});

describe("applyResponse", () => {
  it("accepts a freshly invited assignment", () => {
    expect(applyResponse("invited", "accept")).toEqual({
      next: "accepted",
      changed: true,
      outcome: "accepted",
    });
  });

  it("declines a freshly invited assignment", () => {
    expect(applyResponse("invited", "decline")).toEqual({
      next: "declined",
      changed: true,
      outcome: "declined",
    });
  });

  it("accepts from pending / no_response too", () => {
    expect(applyResponse("pending", "accept").next).toBe("accepted");
    expect(applyResponse("no_response", "decline").next).toBe("declined");
  });

  it("is idempotent — re-accepting an accepted assignment is a no-op", () => {
    expect(applyResponse("accepted", "accept")).toEqual({
      next: "accepted",
      changed: false,
      outcome: "unchanged",
    });
  });

  it("is idempotent — re-declining a declined assignment is a no-op", () => {
    expect(applyResponse("declined", "decline")).toEqual({
      next: "declined",
      changed: false,
      outcome: "unchanged",
    });
  });

  it("allows a change of mind: accepted → declined", () => {
    expect(applyResponse("accepted", "decline")).toEqual({
      next: "declined",
      changed: true,
      outcome: "declined",
    });
  });

  it("allows a change of mind: declined → accepted", () => {
    expect(applyResponse("declined", "accept")).toEqual({
      next: "accepted",
      changed: true,
      outcome: "accepted",
    });
  });

  it("treats a removed assignment as closed for both actions", () => {
    expect(applyResponse("removed", "accept")).toEqual({
      next: "removed",
      changed: false,
      outcome: "closed",
    });
    expect(applyResponse("removed", "decline")).toEqual({
      next: "removed",
      changed: false,
      outcome: "closed",
    });
  });
});

describe("consumeSingleUseLink (atomic single-use, TOCTOU race)", () => {
  // A test double for a single magic_link row whose single-use claim is decided
  // INSIDE the conditional UPDATE: `is("used_at", null)` only matches while the
  // row is unclaimed, so two callers race against the same row exactly as they
  // would in Postgres. Each `.select("id")` returns the row only if this call
  // was the one that flipped used_at from null.
  function fakeStore(initial: { id: string; used_at: string | null }) {
    const row = { ...initial };
    const client = {
      from() {
        return {
          update(values: { used_at: string }) {
            return {
              eq() {
                return {
                  is(_col: "used_at", _value: null) {
                    return {
                      select() {
                        // Conditional match: only an unclaimed row is touched.
                        if (row.used_at === null) {
                          row.used_at = values.used_at;
                          return Promise.resolve({ data: [{ id: row.id }], error: null });
                        }
                        return Promise.resolve({ data: [], error: null });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
    return { client, row };
  }

  it("only ONE of two concurrent claims on the same single-use link succeeds", async () => {
    const { client } = fakeStore({ id: "ml1", used_at: null });
    // Both POSTs fire before either has finished (Promise.all = concurrent).
    const [a, b] = await Promise.all([
      consumeSingleUseLink(client, "hash"),
      consumeSingleUseLink(client, "hash"),
    ]);
    const wins = [a, b].filter((r) => r.ok).length;
    const losses = [a, b].filter((r) => !r.ok && r.reason === "already_used").length;
    expect(wins).toBe(1);
    expect(losses).toBe(1);
  });

  it("reports already_used for an already-consumed link", async () => {
    const { client } = fakeStore({ id: "ml1", used_at: "2026-06-01T00:00:00.000Z" });
    const res = await consumeSingleUseLink(client, "hash");
    expect(res).toEqual({ ok: false, reason: "already_used" });
  });

  it("succeeds for a fresh unclaimed link", async () => {
    const { client, row } = fakeStore({ id: "ml1", used_at: null });
    const res = await consumeSingleUseLink(client, "hash", new Date("2026-06-04T10:00:00Z"));
    expect(res).toEqual({ ok: true });
    expect(row.used_at).toBe("2026-06-04T10:00:00.000Z");
  });

  it("surfaces a DB error as consume_failed without claiming", async () => {
    const client = {
      from() {
        return {
          update() {
            return {
              eq() {
                return {
                  is() {
                    return {
                      select: () => Promise.resolve({ data: null, error: { message: "boom" } }),
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
    const res = await consumeSingleUseLink(client, "hash");
    expect(res).toEqual({ ok: false, reason: "consume_failed", detail: "boom" });
  });
});
