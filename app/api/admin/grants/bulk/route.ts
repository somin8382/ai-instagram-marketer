import { type NextRequest, NextResponse } from "next/server";
import {
  applyGrantCreditDelta,
  assertAdmin,
  getSupabaseServiceRoleClient,
} from "@/lib/server/admin";
import { getKoreaDateString } from "@/lib/post-generator/subscription";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

// ── Canonical fields ──────────────────────────────────────────────────────────
type Field =
  | "email"
  | "applicant_name"
  | "phone"
  | "host_org"
  | "mentor_org"
  | "ai_marketer"
  | "marketer_quantity"
  | "marketer_months"
  | "ai_generator"
  | "generator_months"
  | "generator_credits";

const ALL_FIELDS: Field[] = [
  "email",
  "applicant_name",
  "phone",
  "host_org",
  "mentor_org",
  "ai_marketer",
  "marketer_quantity",
  "marketer_months",
  "ai_generator",
  "generator_months",
  "generator_credits",
];

// ── Fuzzy header matching ─────────────────────────────────────────────────────
// Normalize: lowercase, remove whitespace, remove parentheses (and other
// brackets) so "선택 멘토기관", "주관기관명", "주관 기관(명)" all collapse to a
// comparable token. Then apply alias "contains" rules in priority order — more
// specific fields (mentor/quantity/months/credits) are checked BEFORE the
// broader ones (host_org, ai_marketer) so "멘토기관" doesn't fall into host.
function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[()[\]{}<>]/g, "")
    .replace(/[\s_\-.]/g, "")
    .trim();
}

const FIELD_MATCHERS: Array<{ field: Field; keywords: string[] }> = [
  // most specific first
  { field: "marketer_quantity", keywords: ["marketerquantity", "마케터수량", "수량", "quantity"] },
  { field: "marketer_months", keywords: ["marketermonths", "마케터개월", "마케터월"] },
  { field: "generator_months", keywords: ["generatormonths", "생성기개월", "생성기월"] },
  { field: "generator_credits", keywords: ["generatorcredits", "크레딧", "생성횟수", "credits", "횟수"] },
  { field: "ai_marketer", keywords: ["aimarketer", "마케터", "marketer"] },
  { field: "ai_generator", keywords: ["aigenerator", "생성기", "generator"] },
  // "상위 멘토기관"(상위기관) = 상위/모(母) 기관 → 주관기관으로 취급. 반드시
  // mentor_org보다 먼저 검사해야 "상위멘토기관"이 멘토로 빠지지 않는다.
  { field: "host_org", keywords: ["상위멘토기관", "상위주관기관", "상위기관", "상위"] },
  { field: "mentor_org", keywords: ["멘토기관", "멘토", "mentor"] },
  { field: "host_org", keywords: ["주관기관", "주관", "기관명", "소속", "기관", "host"] },
  { field: "email", keywords: ["email", "이메일", "메일", "mail"] },
  { field: "applicant_name", keywords: ["이름", "성명", "성함", "담당자", "신청자", "대표자", "name"] },
  { field: "phone", keywords: ["전화", "휴대폰", "핸드폰", "연락처", "번호", "phone", "tel", "mobile", "hp"] },
];

function detectFieldFromHeader(header: string): Field | null {
  const norm = normalizeHeader(header);
  if (!norm) return null;
  for (const { field, keywords } of FIELD_MATCHERS) {
    if (keywords.some((k) => norm.includes(normalizeHeader(k)))) {
      return field;
    }
  }
  return null;
}

// ── Value patterns (for header-less / unknown columns) ────────────────────────
function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  const at = v.indexOf("@");
  return at > 0 && v.includes(".", at + 2) && !/\s/.test(v);
}

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length < 9 || digits.length > 13) return false;
  // Korean numbers: 01x… mobile, 0xx… landline, or +82. Reject if it has letters.
  return /^[0-9()+\-\s.]+$/.test(value.trim());
}

function isValidEmail(email: string): boolean {
  return looksLikeEmail(email);
}

function parseBool(value: string): boolean {
  return ["true", "1", "yes", "y", "o", "예", "네", "가능", "포함"].includes(
    value.trim().toLowerCase()
  );
}

// ── Delimiter detection + tokenizer ───────────────────────────────────────────
type Delimiter = "\t" | "," | ";" | "  "; // "  " = multi-space marker

// Quote-aware split for a single line (handles "a, b" and "" escapes for ,/;).
function splitLine(line: string, delim: Delimiter): string[] {
  if (delim === "\t") return line.split("\t");
  if (delim === "  ") return line.split(/\s{2,}/);

  const sep = delim; // "," or ";"
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function detectDelimiter(lines: string[]): Delimiter {
  const sample = lines.slice(0, 15);
  if (sample.some((l) => l.includes("\t"))) return "\t";

  const modalCols = (delim: Delimiter): { modal: number; consistency: number } => {
    const counts = sample.map((l) => splitLine(l, delim).length);
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    let modal = 1;
    let best = 0;
    for (const [c, n] of freq) {
      if (n > best) {
        best = n;
        modal = c;
      }
    }
    return { modal, consistency: best / counts.length };
  };

  for (const d of [",", ";"] as Delimiter[]) {
    const { modal, consistency } = modalCols(d);
    if (modal > 1 && consistency >= 0.6) return d;
  }
  const ms = modalCols("  ");
  if (ms.modal > 1 && ms.consistency >= 0.6) return "  ";
  // fall back to comma (single-column input still tokenizes to 1 cell)
  return ",";
}

function tokenize(text: string): { rows: string[][]; delimiter: Delimiter } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], delimiter: "," };
  const delimiter = detectDelimiter(lines);
  const rows = lines.map((l) =>
    splitLine(l, delimiter).map((c) => c.trim().replace(/^"|"$/g, "").trim())
  );
  return { rows, delimiter };
}

// ── Header + auto-mapping ─────────────────────────────────────────────────────
function detectHasHeader(rows: string[][]): boolean {
  if (rows.length === 0) return false;
  const row0 = rows[0];
  // If row 0 already contains an email/phone value, it's data, not a header.
  if (row0.some((c) => looksLikeEmail(c))) return false;
  // Header if at least one cell fuzzy-matches a known field name.
  return row0.some((c) => detectFieldFromHeader(c) !== null);
}

function inferColumnField(dataRows: string[][], col: number): Field | null {
  const samples = dataRows
    .map((r) => (r[col] ?? "").trim())
    .filter((v) => v.length > 0)
    .slice(0, 25);
  if (samples.length === 0) return null;
  const emailHits = samples.filter(looksLikeEmail).length / samples.length;
  if (emailHits >= 0.6) return "email";
  const phoneHits = samples.filter(looksLikePhone).length / samples.length;
  if (phoneHits >= 0.6) return "phone";
  return null;
}

// Auto mapping: header match first, then value inference for unmatched columns.
// A field is assigned to at most one column (first wins); admin can override.
function buildAutoMapping(
  rows: string[][],
  hasHeader: boolean
): Record<number, Field> {
  const colCount = Math.max(...rows.map((r) => r.length), 0);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const mapping: Record<number, Field> = {};
  const used = new Set<Field>();

  if (hasHeader) {
    const header = rows[0];
    for (let c = 0; c < colCount; c++) {
      const f = detectFieldFromHeader(header[c] ?? "");
      if (f && !used.has(f)) {
        mapping[c] = f;
        used.add(f);
      }
    }
  }
  // Fill remaining columns by value inference (email/phone only).
  for (let c = 0; c < colCount; c++) {
    if (mapping[c]) continue;
    const f = inferColumnField(dataRows, c);
    if (f && !used.has(f)) {
      mapping[c] = f;
      used.add(f);
    }
  }
  return mapping;
}

// ── Build a grant row from tokenized cells + mapping ──────────────────────────
type ParsedGrantRow = {
  rowIndex: number;
  email: string;
  normalizedEmail: string;
  applicant_name: string | null;
  phone: string | null;
  host_org: string | null;
  mentor_org: string | null;
  ai_marketer: boolean;
  ai_generator: boolean;
  marketer_quantity: number | null;
  marketer_months: string | null;
  generator_months: string | null;
  generator_credits: number;
  // How this row identifies its target grant:
  //  - "email": has a valid email (new registration OR update-by-email)
  //  - "namephone": no email — update an EXISTING grant matched by 이름+전화
  matchMode: "email" | "namephone";
  matchKey: string;
  // Fields the row actually supplied (mapped column present + non-empty cell).
  // On UPDATE we only overwrite these — absent/blank fields keep their existing
  // value (so e.g. an unmentioned ai_generator=true is never reset to false).
  provided: Set<Field>;
};

type ParseError = { rowIndex: number; email: string; reason: string };

function normName(s: string): string {
  return s.trim().toLowerCase();
}
function normPhone(s: string): string {
  return s.replace(/[^0-9]/g, "");
}

function cellsToGrant(
  cells: string[],
  mapping: Record<number, Field>,
  rowIndex: number
): { row?: ParsedGrantRow; error?: ParseError } {
  const get = (field: Field): string => {
    for (const [col, f] of Object.entries(mapping)) {
      if (f === field) return (cells[Number(col)] ?? "").trim();
    }
    return "";
  };

  const rawEmail = get("email");
  const normalizedEmail = rawEmail.toLowerCase();
  const name = get("applicant_name");
  const phone = get("phone");
  const hasValidEmail = Boolean(rawEmail) && isValidEmail(normalizedEmail);

  // Identity rule: a valid email drives new-registration + email updates.
  // Without email, the row can only UPDATE an existing grant, identified by
  // 이름+전화 — so both are required in that case.
  let matchMode: "email" | "namephone";
  let matchKey: string;
  if (hasValidEmail) {
    matchMode = "email";
    matchKey = "e:" + normalizedEmail;
  } else if (name && normPhone(phone)) {
    matchMode = "namephone";
    matchKey = "np:" + normName(name) + "|" + normPhone(phone);
  } else if (rawEmail) {
    return { error: { rowIndex, email: rawEmail, reason: "이메일 형식 오류" } };
  } else {
    return {
      error: {
        rowIndex,
        email: rawEmail,
        reason: "이메일이 없으면 이름과 전화번호가 모두 필요합니다",
      },
    };
  }

  // Which fields the row actually supplied (non-empty cell in a mapped column).
  const provided = new Set<Field>();
  for (const f of ALL_FIELDS) {
    if (get(f) !== "") provided.add(f);
  }

  const aiMarketer = parseBool(get("ai_marketer"));
  const aiGenerator = parseBool(get("ai_generator"));

  const rawQty = get("marketer_quantity");
  const marketerQuantity = rawQty ? Number(rawQty) || 1 : aiMarketer ? 1 : null;
  const rawCredits = get("generator_credits");
  const generatorCredits = rawCredits ? Number(rawCredits) || 40 : 40;

  return {
    row: {
      rowIndex,
      email: rawEmail,
      normalizedEmail,
      applicant_name: name || null,
      phone: phone || null,
      host_org: get("host_org") || null,
      mentor_org: get("mentor_org") || null,
      ai_marketer: aiMarketer,
      ai_generator: aiGenerator,
      marketer_quantity: marketerQuantity,
      marketer_months: get("marketer_months") || null,
      generator_months: get("generator_months") || null,
      generator_credits: generatorCredits,
      matchMode,
      matchKey,
      provided,
    },
  };
}

function buildGrantRows(
  rows: string[][],
  mapping: Record<number, Field>,
  hasHeader: boolean
): { valid: ParsedGrantRow[]; errors: ParseError[] } {
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const valid: ParsedGrantRow[] = [];
  const errors: ParseError[] = [];
  dataRows.forEach((cells, i) => {
    const { row, error } = cellsToGrant(cells, mapping, i + 1);
    if (row) valid.push(row);
    else if (error) errors.push(error);
  });
  return { valid, errors };
}

// Coerce a client-supplied mapping (JSON keys are strings) into typed form.
function normalizeMapping(input: unknown): Record<number, Field> {
  const out: Record<number, Field> = {};
  if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const col = Number(k);
      if (Number.isInteger(col) && typeof v === "string" && ALL_FIELDS.includes(v as Field)) {
        out[col] = v as Field;
      }
    }
  }
  return out;
}

// ── Existing-grant type + change diffing (for readable before/after) ──────────
type ExistingGrant = {
  id: string;
  email: string;
  applicant_name: string | null;
  phone: string | null;
  host_org: string | null;
  mentor_org: string | null;
  ai_marketer: boolean;
  ai_generator: boolean;
  marketer_quantity: number | null;
  marketer_months: string | null;
  generator_months: string | null;
  generator_credits: number;
  applied_user_id: string | null;
};

const DIFF_FIELDS: Array<{ key: keyof ParsedGrantRow; label: string }> = [
  { key: "applicant_name", label: "이름" },
  { key: "phone", label: "전화" },
  { key: "host_org", label: "주관기관" },
  { key: "mentor_org", label: "멘토기관" },
  { key: "ai_marketer", label: "AI마케터" },
  { key: "ai_generator", label: "AI생성기" },
  { key: "generator_credits", label: "크레딧" },
];

// Diff for an UPDATE: only fields the row actually supplied are candidates for
// change — everything else keeps its existing value, so it never shows (and is
// never written) as a change.
function diffChanges(
  next: ParsedGrantRow,
  prev: ExistingGrant
): Array<{ label: string; from: string; to: string }> {
  const fmt = (v: unknown) =>
    v === null || v === undefined || v === "" ? "-" : String(v);
  const changes: Array<{ label: string; from: string; to: string }> = [];
  for (const { key, label } of DIFF_FIELDS) {
    if (!next.provided.has(key as Field)) continue;
    const to = (next as unknown as Record<string, unknown>)[key];
    const from = (prev as unknown as Record<string, unknown>)[key];
    if (fmt(to) !== fmt(from)) changes.push({ label, from: fmt(from), to: fmt(to) });
  }
  return changes;
}

// Effective value shown in the UPDATE preview: the supplied value when given,
// otherwise the existing (preserved) value.
function mergedValue<K extends keyof ExistingGrant & Field>(
  row: ParsedGrantRow,
  existing: ExistingGrant,
  key: K
): ExistingGrant[K] {
  return row.provided.has(key)
    ? ((row as unknown as Record<string, unknown>)[key] as ExistingGrant[K])
    : existing[key];
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const token = extractBearerToken(request);
  const adminResult = await assertAdmin(token);
  if (!adminResult.ok) {
    return NextResponse.json({}, { status: adminResult.status });
  }

  let body: {
    action?: string;
    text?: string;
    rows?: unknown; // string (legacy) OR string[][] (new)
    mapping?: unknown;
    hasHeader?: unknown;
    dryRun?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  // ── Phase 1: parse/detect (no DB) ───────────────────────────────────────────
  if (body.action === "parse") {
    const text = typeof body.text === "string" ? body.text : "";
    const { rows, delimiter } = tokenize(text);
    if (rows.length === 0) {
      return NextResponse.json({ rows: [], columns: [], hasHeader: false, delimiter, rowCount: 0 });
    }
    const hasHeader = detectHasHeader(rows);
    const mapping = buildAutoMapping(rows, hasHeader);
    const dataRows = hasHeader ? rows.slice(1) : rows;
    const colCount = Math.max(...rows.map((r) => r.length), 0);
    const columns = Array.from({ length: colCount }).map((_, c) => ({
      index: c,
      header: hasHeader ? (rows[0][c] ?? "") : "",
      detected: mapping[c] ?? null,
      samples: dataRows
        .map((r) => (r[c] ?? "").trim())
        .filter((v) => v.length > 0)
        .slice(0, 3),
    }));
    return NextResponse.json({
      rows,
      columns,
      hasHeader,
      delimiter: delimiter === "\t" ? "탭" : delimiter === "  " ? "공백" : delimiter,
      rowCount: dataRows.length,
    });
  }

  // ── Resolve tokenized rows + mapping (new) OR legacy string path ────────────
  let tokenRows: string[][];
  let mapping: Record<number, Field>;
  let hasHeader: boolean;

  if (typeof body.rows === "string") {
    // Legacy: raw text → auto tokenize + auto map (keeps old callers working).
    const tk = tokenize(body.rows);
    tokenRows = tk.rows;
    hasHeader = detectHasHeader(tokenRows);
    mapping = buildAutoMapping(tokenRows, hasHeader);
  } else if (Array.isArray(body.rows)) {
    tokenRows = (body.rows as unknown[][]).map((r) =>
      Array.isArray(r) ? r.map((c) => String(c ?? "")) : []
    );
    mapping = normalizeMapping(body.mapping);
    hasHeader = body.hasHeader === true;
  } else {
    return NextResponse.json({ error: "붙여넣은 데이터가 없습니다." }, { status: 400 });
  }

  const dryRun = body.dryRun === true;

  // Need either an email column (신규 등록·이메일 수정) OR 이름+전화 columns
  // (이메일 없이 기존 항목 변경). Otherwise nothing can be identified.
  const mapped = Object.values(mapping);
  const hasEmailCol = mapped.includes("email");
  const hasNamePhoneCols =
    mapped.includes("applicant_name") && mapped.includes("phone");
  if (!hasEmailCol && !hasNamePhoneCols) {
    return NextResponse.json(
      {
        error:
          "이메일 열, 또는 이름+전화 열을 지정해주세요. (신규 등록은 이메일 필요, 변경은 이름+전화로 가능)",
      },
      { status: 400 }
    );
  }

  const { valid, errors } = buildGrantRows(tokenRows, mapping, hasHeader);

  if (valid.length === 0 && errors.length === 0) {
    return dryRun
      ? NextResponse.json({ rows: [], totals: { new: 0, update: 0, error: 0 } })
      : NextResponse.json({ inserted: 0, updated: 0, skipped: 0, rowErrors: [] });
  }

  // Dedupe within the batch — last occurrence wins. Email rows key on the
  // email; no-email rows key on 이름+전화 (matchKey is already prefixed so the
  // two namespaces never collide).
  const dedupeMap = new Map<string, ParsedGrantRow>();
  for (const row of valid) dedupeMap.set(row.matchKey, row);
  const deduped = [...dedupeMap.values()];

  const db = getSupabaseServiceRoleClient();

  const existingRes = (await (
    db
      .from("service_grants")
      .select(
        "id, email, applicant_name, phone, host_org, mentor_org, ai_marketer, ai_generator, marketer_quantity, marketer_months, generator_months, generator_credits, applied_user_id"
      ) as unknown
  )) as { data: ExistingGrant[] | null; error: { message: string } | null };

  if (existingRes.error) {
    return NextResponse.json({ error: "데이터베이스 조회에 실패했습니다." }, { status: 500 });
  }

  // Index existing grants two ways: by email (for email rows) and by 이름+전화
  // (for no-email update rows). The name+phone index keeps a list so we can
  // detect ambiguous matches (same 이름+전화 across multiple grants).
  const existingByEmail = new Map<string, ExistingGrant>();
  const existingByNamePhone = new Map<string, ExistingGrant[]>();
  for (const g of existingRes.data ?? []) {
    if (g.email) existingByEmail.set(g.email.trim().toLowerCase(), g);
    const nm = normName(g.applicant_name ?? "");
    const ph = normPhone(g.phone ?? "");
    if (nm && ph) {
      const key = nm + "|" + ph;
      const arr = existingByNamePhone.get(key) ?? [];
      arr.push(g);
      existingByNamePhone.set(key, arr);
    }
  }

  // Classify each deduped row into insert / update / error. Email rows insert
  // when new and update when the email exists. No-email rows can ONLY update an
  // existing grant identified by 이름+전화 — a unique match updates it (email
  // untouched), no match or an ambiguous match is an error (신규 등록엔 이메일 필요).
  type Classified =
    | { kind: "insert"; row: ParsedGrantRow }
    | { kind: "update"; row: ParsedGrantRow; existing: ExistingGrant }
    | { kind: "error"; rowIndex: number; email: string; reason: string };

  const classified: Classified[] = deduped.map((row): Classified => {
    if (row.matchMode === "email") {
      const existing = existingByEmail.get(row.normalizedEmail);
      return existing ? { kind: "update", row, existing } : { kind: "insert", row };
    }
    // namephone (no email) → update-only
    const npKey = row.matchKey.slice(3); // strip "np:" prefix
    const matches = existingByNamePhone.get(npKey) ?? [];
    if (matches.length === 1) {
      return { kind: "update", row, existing: matches[0] };
    }
    if (matches.length === 0) {
      return {
        kind: "error",
        rowIndex: row.rowIndex,
        email: "",
        reason: "이메일이 없고 이름+전화가 일치하는 기존 항목이 없습니다 (신규 등록은 이메일 필요)",
      };
    }
    return {
      kind: "error",
      rowIndex: row.rowIndex,
      email: "",
      reason: "이름+전화가 같은 기존 항목이 여러 개라 대상을 특정할 수 없습니다",
    };
  });

  const toInsert = classified.filter(
    (c): c is Extract<Classified, { kind: "insert" }> => c.kind === "insert"
  );
  const toUpdate = classified.filter(
    (c): c is Extract<Classified, { kind: "update" }> => c.kind === "update"
  );
  // Rows that failed field validation + rows that failed classification.
  const allErrors: ParseError[] = [
    ...errors,
    ...classified
      .filter((c): c is Extract<Classified, { kind: "error" }> => c.kind === "error")
      .map((c) => ({ rowIndex: c.rowIndex, email: c.email, reason: c.reason })),
  ];

  // ── Phase 2: preview (dry run) ──────────────────────────────────────────────
  if (dryRun) {
    const previewRows = [
      ...toInsert.map(({ row: r }) => ({
        rowIndex: r.rowIndex,
        action: "신규 등록" as const,
        email: r.email,
        applicant_name: r.applicant_name,
        host_org: r.host_org,
        mentor_org: r.mentor_org,
        phone: r.phone,
        ai_marketer: r.ai_marketer,
        ai_generator: r.ai_generator,
        generator_credits: r.generator_credits,
        changes: [] as Array<{ label: string; from: string; to: string }>,
      })),
      ...toUpdate.map(({ row: r, existing }) => ({
        rowIndex: r.rowIndex,
        action: "기존 수정" as const,
        // Show the EFFECTIVE result: supplied values override, everything else
        // keeps the existing value (email is never changed on update).
        email: existing.email,
        applicant_name: mergedValue(r, existing, "applicant_name"),
        host_org: mergedValue(r, existing, "host_org"),
        mentor_org: mergedValue(r, existing, "mentor_org"),
        phone: mergedValue(r, existing, "phone"),
        ai_marketer: mergedValue(r, existing, "ai_marketer"),
        ai_generator: mergedValue(r, existing, "ai_generator"),
        generator_credits: mergedValue(r, existing, "generator_credits"),
        matchedBy: r.matchMode === "namephone" ? ("이름+전화" as const) : undefined,
        changes: diffChanges(r, existing),
      })),
      ...allErrors.map((e) => ({
        rowIndex: e.rowIndex,
        action: "오류" as const,
        email: e.email,
        applicant_name: null,
        host_org: null,
        mentor_org: null,
        phone: null,
        ai_marketer: false,
        ai_generator: false,
        generator_credits: 0,
        reason: e.reason,
        changes: [] as Array<{ label: string; from: string; to: string }>,
      })),
    ].sort((a, b) => a.rowIndex - b.rowIndex);

    return NextResponse.json({
      rows: previewRows,
      totals: { new: toInsert.length, update: toUpdate.length, error: allErrors.length },
    });
  }

  // ── Phase 3: write ──────────────────────────────────────────────────────────
  const rowErrors: ParseError[] = [...allErrors];
  let inserted = 0;
  let updated = 0;
  const todayKr = getKoreaDateString();

  for (const { row, existing } of toUpdate) {
    // Only overwrite fields the row actually supplied — absent/blank fields keep
    // their existing value. Email is never updated (email-row updates already
    // target the same email; no-email rows must leave the matched email intact).
    const patch: Record<string, unknown> = {};
    const setIf = (field: Field, value: unknown) => {
      if (row.provided.has(field)) patch[field] = value;
    };
    setIf("applicant_name", row.applicant_name);
    setIf("phone", row.phone);
    setIf("host_org", row.host_org);
    setIf("mentor_org", row.mentor_org);
    setIf("ai_marketer", row.ai_marketer);
    setIf("ai_generator", row.ai_generator);
    setIf("marketer_quantity", row.marketer_quantity);
    setIf("marketer_months", row.marketer_months);
    setIf("generator_months", row.generator_months);
    setIf("generator_credits", row.generator_credits);

    // Nothing supplied changed anything → skip the write entirely.
    if (Object.keys(patch).length === 0) {
      updated++;
      continue;
    }

    const updateRes = (await (
      db
        .from("service_grants")
        .update(patch as never)
        .eq("id", existing.id) as unknown
    )) as { error: { message: string } | null };

    if (updateRes.error) {
      rowErrors.push({
        rowIndex: row.rowIndex,
        email: row.email || existing.email,
        reason: updateRes.error.message,
      });
    } else {
      updated++;
      if (
        existing.applied_user_id &&
        row.provided.has("generator_credits") &&
        row.generator_credits !== existing.generator_credits
      ) {
        await applyGrantCreditDelta({
          db,
          appliedUserId: existing.applied_user_id,
          oldCredits: existing.generator_credits,
          newCredits: row.generator_credits,
          todayKr,
        });
      }
    }
  }

  for (const { row } of toInsert) {
    const insertRes = (await (
      db
        .from("service_grants")
        .insert({
          email: row.email,
          applicant_name: row.applicant_name,
          phone: row.phone,
          host_org: row.host_org,
          mentor_org: row.mentor_org,
          ai_marketer: row.ai_marketer,
          ai_generator: row.ai_generator,
          marketer_quantity: row.marketer_quantity,
          marketer_months: row.marketer_months,
          generator_months: row.generator_months,
          generator_credits: row.generator_credits,
        } as never) as unknown
    )) as { error: { message: string } | null };

    if (insertRes.error) {
      rowErrors.push({ rowIndex: row.rowIndex, email: row.email, reason: insertRes.error.message });
    } else {
      inserted++;
    }
  }

  return NextResponse.json({
    inserted,
    updated,
    skipped: allErrors.length,
    rowErrors,
  });
}
