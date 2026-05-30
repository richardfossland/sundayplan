/**
 * Phase 2 — pure member-import parser. Turns a pasted CSV/TSV block (the way a
 * small church already keeps its list — a spreadsheet export or a copy out of
 * one) into validated, normalized rows the data layer can insert. No I/O.
 *
 * Tolerant by design: detects the delimiter, accepts an optional header row
 * with Norwegian or English aliases, normalizes bare Norwegian mobile numbers
 * to E.164, dedupes within the paste, and reports per-line problems rather than
 * failing the whole batch — so a planner pastes 60 rows and fixes the 3 that
 * complained.
 */

export interface ParsedMemberRow {
  display_name: string;
  phone_e164: string | null;
  email: string | null;
  household: string | null;
  tags: string[];
}

export interface MemberImportResult {
  rows: ParsedMemberRow[];
  errors: { line: number; message: string }[];
  /** Rows dropped because an earlier row had the same phone/name. */
  duplicates: number;
}

type Column = "name" | "phone" | "email" | "household" | "tags";

const HEADER_ALIASES: Record<string, Column> = {
  name: "name", navn: "name", display_name: "name", fullname: "name", "full name": "name",
  phone: "phone", telefon: "phone", mobil: "phone", tlf: "phone", mobile: "phone", number: "phone",
  email: "email", "e-post": "email", epost: "email", "e-mail": "email", mail: "email",
  household: "household", familie: "household", husstand: "household", family: "household",
  tags: "tags", tagger: "tags", grupper: "tags", groups: "tags", labels: "tags",
};

const DEFAULT_ORDER: Column[] = ["name", "phone", "email", "household", "tags"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;

function detectDelimiter(line: string): string {
  if (line.includes("\t")) return "\t";
  if (line.includes(";") && !line.includes(",")) return ";";
  return ",";
}

function splitRow(line: string, delim: string): string[] {
  return line.split(delim).map((c) => c.trim());
}

function looksLikeHeader(cells: string[]): boolean {
  return cells.some((c) => HEADER_ALIASES[c.toLowerCase()] !== undefined);
}

/** Normalize a phone string to E.164, or null if blank, or `false` if invalid. */
function normalizePhone(raw: string): string | null | false {
  const s = raw.replace(/[\s()-]/g, "");
  if (s.length === 0) return null;
  let candidate = s;
  if (!candidate.startsWith("+")) {
    if (candidate.startsWith("00")) candidate = "+" + candidate.slice(2);
    else if (/^[49]\d{7}$/.test(candidate)) candidate = "+47" + candidate; // bare NO mobile
    else candidate = "+" + candidate;
  }
  return E164_RE.test(candidate) ? candidate : false;
}

function splitTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[|;]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    ),
  ];
}

export function parseMemberImport(text: string): MemberImportResult {
  const result: MemberImportResult = { rows: [], errors: [], duplicates: 0 };
  const rawLines = text.split(/\r?\n/);
  // Track original line numbers for friendly errors while skipping blanks.
  const lines: { n: number; text: string }[] = [];
  rawLines.forEach((t, i) => {
    if (t.trim().length > 0) lines.push({ n: i + 1, text: t });
  });
  if (lines.length === 0) return result;

  const delim = detectDelimiter(lines[0].text);
  let order = DEFAULT_ORDER;
  let start = 0;
  const firstCells = splitRow(lines[0].text, delim);
  if (looksLikeHeader(firstCells)) {
    order = firstCells.map((c) => HEADER_ALIASES[c.toLowerCase()] ?? ("" as Column));
    start = 1;
  }

  const seen = new Set<string>();
  for (let i = start; i < lines.length; i++) {
    const { n, text: line } = lines[i];
    const cells = splitRow(line, delim);
    const get = (col: Column): string => {
      const idx = order.indexOf(col);
      return idx >= 0 ? (cells[idx] ?? "") : "";
    };

    const display_name = get("name");
    if (display_name.length === 0) {
      result.errors.push({ line: n, message: "missing name" });
      continue;
    }

    const phone = normalizePhone(get("phone"));
    if (phone === false) {
      result.errors.push({ line: n, message: `invalid phone "${get("phone")}"` });
      continue;
    }

    const emailRaw = get("email");
    let email: string | null = null;
    if (emailRaw.length > 0) {
      if (!EMAIL_RE.test(emailRaw)) {
        result.errors.push({ line: n, message: `invalid email "${emailRaw}"` });
        continue;
      }
      email = emailRaw;
    }

    const householdRaw = get("household");
    const household = householdRaw.length > 0 ? householdRaw : null;
    const tags = splitTags(get("tags"));

    // Dedupe within the paste — phone is the strong key, else the name.
    const key = phone ? `p:${phone}` : `n:${display_name.toLowerCase()}`;
    if (seen.has(key)) {
      result.duplicates += 1;
      continue;
    }
    seen.add(key);

    result.rows.push({ display_name, phone_e164: phone, email, household, tags });
  }

  return result;
}
