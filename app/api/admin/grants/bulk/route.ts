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

// --- Column name → canonical field mapping (Korean + English aliases) ---
const HEADER_MAP: Record<string, string> = {
  email: "email",
  이메일: "email",
  이름: "applicant_name",
  name: "applicant_name",
  applicant_name: "applicant_name",
  전화: "phone",
  휴대폰: "phone",
  phone: "phone",
  주관기관: "host_org",
  host_org: "host_org",
  "선택 멘토기관": "mentor_org",
  mentor_org: "mentor_org",
  ai_marketer: "ai_marketer",
  marketer_quantity: "marketer_quantity",
  marketer_months: "marketer_months",
  ai_generator: "ai_generator",
  generator_months: "generator_months",
  generator_credits: "generator_credits",
};

function parseBool(value: string): boolean {
  return ["true", "1", "yes", "y"].includes(value.trim().toLowerCase());
}

function isValidEmail(email: string): boolean {
  const atIdx = email.indexOf("@");
  return atIdx > 0 && email.includes(".", atIdx + 2);
}

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
};

type ParseError = { rowIndex: number; email: string; reason: string };

type ParseResult = {
  headerError: string | null;
  valid: ParsedGrantRow[];
  errors: ParseError[];
};

function parseBulkText(raw: string): ParseResult {
  const allLines = raw.split(/\r?\n/);
  const nonEmpty = allLines.filter((l) => l.trim().length > 0);

  if (nonEmpty.length === 0) {
    return { headerError: null, valid: [], errors: [] };
  }

  // Detect separator from the header line
  const headerLine = nonEmpty[0];
  const sep = headerLine.includes("\t") ? "\t" : ",";

  // Map raw header names to canonical field names
  const rawHeaders = headerLine.split(sep).map((h) => h.trim().toLowerCase());
  const canonicalHeaders = rawHeaders.map((h) => HEADER_MAP[h] ?? null);

  // Refinement 3: reject if no email column is recognized
  if (!canonicalHeaders.includes("email")) {
    return {
      headerError: "헤더 행이 필요합니다 (이메일 열이 없습니다)",
      valid: [],
      errors: [],
    };
  }

  const valid: ParsedGrantRow[] = [];
  const errors: Array<{ rowIndex: number; email: string; reason: string }> = [];
  let dataIdx = 0;

  for (let i = 1; i < nonEmpty.length; i++) {
    dataIdx++;
    const line = nonEmpty[i];

    const cells = line.split(sep);
    const raw: Record<string, string> = {};
    for (let j = 0; j < canonicalHeaders.length; j++) {
      const field = canonicalHeaders[j];
      if (field) raw[field] = (cells[j] ?? "").trim();
    }

    const rawEmail = raw.email?.trim() ?? "";
    const normalizedEmail = rawEmail.toLowerCase();

    if (!rawEmail || !isValidEmail(normalizedEmail)) {
      errors.push({
        rowIndex: dataIdx,
        email: rawEmail,
        reason: "이메일 없음 또는 형식 오류",
      });
      continue;
    }

    const aiMarketer = parseBool(raw.ai_marketer ?? "");
    const aiGenerator = parseBool(raw.ai_generator ?? "");

    const rawMarketerQty = raw.marketer_quantity?.trim();
    const marketerQuantity = rawMarketerQty
      ? Number(rawMarketerQty) || 1
      : aiMarketer
        ? 1
        : null;

    const rawCredits = raw.generator_credits?.trim();
    const generatorCredits = rawCredits ? Number(rawCredits) || 40 : 40;

    valid.push({
      rowIndex: dataIdx,
      email: rawEmail,
      normalizedEmail,
      applicant_name: raw.applicant_name || null,
      phone: raw.phone || null,
      host_org: raw.host_org || null,
      mentor_org: raw.mentor_org || null,
      ai_marketer: aiMarketer,
      ai_generator: aiGenerator,
      marketer_quantity: marketerQuantity,
      marketer_months: raw.marketer_months || null,
      generator_months: raw.generator_months || null,
      generator_credits: generatorCredits,
    });
  }

  return { headerError: null, valid, errors };
}

export async function POST(request: NextRequest) {
  const token = extractBearerToken(request);
  const adminResult = await assertAdmin(token);
  if (!adminResult.ok) {
    return NextResponse.json({}, { status: adminResult.status });
  }

  let body: { rows?: unknown; dryRun?: unknown };
  try {
    body = (await request.json()) as { rows?: unknown; dryRun?: unknown };
  } catch {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const rows = typeof body.rows === "string" ? body.rows : "";
  const dryRun = body.dryRun === true;

  const parsed = parseBulkText(rows);

  if (parsed.headerError) {
    return NextResponse.json({ headerError: parsed.headerError }, { status: 400 });
  }

  if (parsed.valid.length === 0 && parsed.errors.length === 0) {
    return NextResponse.json({
      rows: [],
      totals: { new: 0, update: 0, error: 0 },
      inserted: 0,
      updated: 0,
      skipped: 0,
      rowErrors: [],
    });
  }

  // Refinement 2: dedupe within the batch — last occurrence wins
  const dedupeMap = new Map<string, ParsedGrantRow>();
  for (const row of parsed.valid) {
    dedupeMap.set(row.normalizedEmail, row);
  }
  const deduped = [...dedupeMap.values()];

  const db = getSupabaseServiceRoleClient();

  // Fetch all existing grants for email matching (case-insensitive via JS after normalizing).
  // generator_credits + applied_user_id are needed to propagate credit deltas
  // to already-redeemed users' subscriptions (see applyGrantCreditDelta).
  const existingRes = (await (
    db
      .from("service_grants")
      .select("id, email, generator_credits, applied_user_id") as unknown
  )) as {
    data: Array<{
      id: string;
      email: string;
      generator_credits: number;
      applied_user_id: string | null;
    }> | null;
    error: { message: string } | null;
  };

  if (existingRes.error) {
    return NextResponse.json(
      { error: "데이터베이스 조회 실패" },
      { status: 500 }
    );
  }

  // Map: normalizedEmail → existing row
  const existingMap = new Map<
    string,
    { id: string; generator_credits: number; applied_user_id: string | null }
  >();
  for (const row of existingRes.data ?? []) {
    existingMap.set(row.email.trim().toLowerCase(), {
      id: row.id,
      generator_credits: row.generator_credits,
      applied_user_id: row.applied_user_id,
    });
  }

  const toUpdate = deduped.filter((r) => existingMap.has(r.normalizedEmail));
  const toInsert = deduped.filter((r) => !existingMap.has(r.normalizedEmail));

  if (dryRun) {
    const previewRows = [
      ...toUpdate.map((r) => ({
        rowIndex: r.rowIndex,
        email: r.email,
        applicant_name: r.applicant_name,
        action: "기존 수정" as const,
      })),
      ...toInsert.map((r) => ({
        rowIndex: r.rowIndex,
        email: r.email,
        applicant_name: r.applicant_name,
        action: "신규 등록" as const,
      })),
      ...parsed.errors.map((e) => ({
        rowIndex: e.rowIndex,
        email: e.email,
        applicant_name: null,
        action: "오류" as const,
        reason: e.reason,
      })),
    ].sort((a, b) => a.rowIndex - b.rowIndex);

    return NextResponse.json({
      rows: previewRows,
      totals: {
        new: toInsert.length,
        update: toUpdate.length,
        error: parsed.errors.length,
      },
    });
  }

  // --- Write path ---
  const rowErrors: Array<{ rowIndex: number; email: string; reason: string }> =
    [...parsed.errors];
  let inserted = 0;
  let updated = 0;

  // UPDATE existing rows (do NOT touch status / applied_user_id / applied_at)
  const todayKr = getKoreaDateString();
  for (const row of toUpdate) {
    const existing = existingMap.get(row.normalizedEmail)!;
    const updateRes = (await (
      db
        .from("service_grants")
        .update({
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
        } as never)
        .eq("id", existing.id) as unknown
    )) as { error: { message: string } | null };

    if (updateRes.error) {
      rowErrors.push({
        rowIndex: row.rowIndex,
        email: row.email,
        reason: updateRes.error.message,
      });
    } else {
      updated++;
      if (
        existing.applied_user_id &&
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

  // INSERT new rows
  for (const row of toInsert) {
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
      rowErrors.push({
        rowIndex: row.rowIndex,
        email: row.email,
        reason: insertRes.error.message,
      });
    } else {
      inserted++;
    }
  }

  return NextResponse.json({
    inserted,
    updated,
    skipped: parsed.errors.length,
    rowErrors,
  });
}
