import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleClient } from "@/lib/server/admin";
import type { Database } from "@/lib/supabase/types";

// Pre-login (and logged-in) application submission.
//
// The browser used to INSERT into applications directly with the anon key and
// read the id back via RETURNING. With RLS enabled on applications, anonymous
// sessions can insert but cannot see their own row (auth.email() is null), so
// INSERT … RETURNING fails. This endpoint performs the insert with the service
// role and returns the new id, keeping the table locked down for reads.
//
// Security model:
// - user_id is NEVER taken from the client. It is derived from the verified
//   access token, and only bound when the token's email matches the form
//   email (the same re-poisoning rule the client previously enforced).
// - Column whitelists prevent writing anything beyond the known payload
//   (status/created_at/user_id are always server-controlled).

const BASE_APPLICATION_FIELDS = new Set([
  "email",
  "instagram_id",
  "has_account",
  "industry",
  "product_service",
  "marketing_channel",
  "selected_plan",
  "selected_duration",
  "is_express",
  "completion_date",
  "manager_name",
  "phone",
  "depositor_name",
]);

const OPTIONAL_APPLICATION_FIELDS = new Set([
  "account_direction",
  "account_bio",
  "account_concept",
  "channel_url",
  "main_content_url",
  "tax_invoice_requested",
  "business_number",
  "company_name",
  "ceo_name",
  "business_address",
  "business_type",
  "invoice_email",
]);

const MAX_TEXT_LENGTH = 2000;

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, MAX_TEXT_LENGTH);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean" || value === null) return value;
  return null;
}

// Same schema-cache-mismatch resilience the client insert had: drop columns
// PostgREST reports as unknown and retry.
function getMissingApplicationColumnName(errorMessage?: string | null) {
  if (!errorMessage) return null;
  const schemaCacheMatch = errorMessage.match(
    /could not find the '([^']+)' column of 'applications'/i
  );
  if (schemaCacheMatch?.[1]) return schemaCacheMatch[1];
  const relationColumnMatch = errorMessage.match(
    /column\s+applications\.([a-z0-9_]+)\s+does not exist/i
  );
  if (relationColumnMatch?.[1]) return relationColumnMatch[1];
  return null;
}

async function insertWithColumnRetry(
  db: ReturnType<typeof getSupabaseServiceRoleClient>,
  table: "applications" | "payments",
  initialPayload: Record<string, unknown>
): Promise<{ id: string | null; error: string | null }> {
  let payload = { ...initialPayload };

  for (let attempt = 0; attempt < 1 + OPTIONAL_APPLICATION_FIELDS.size; attempt++) {
    const response = (await (
      db
        .from(table)
        .insert(payload as never)
        .select("id")
        .single() as unknown
    )) as {
      data: { id?: string } | null;
      error: { message: string } | null;
    };

    if (!response.error) {
      return { id: String(response.data?.id ?? "") || null, error: null };
    }

    const missingColumn = getMissingApplicationColumnName(response.error.message);
    if (
      table !== "applications" ||
      !missingColumn ||
      !OPTIONAL_APPLICATION_FIELDS.has(missingColumn) ||
      !(missingColumn in payload)
    ) {
      return { id: null, error: response.error.message };
    }

    const next = { ...payload };
    delete next[missingColumn];
    payload = next;
    console.warn(
      "[/api/applications/submit] 스키마 누락 컬럼 제외 후 재시도:",
      missingColumn
    );
  }

  return { id: null, error: "insert retry limit exceeded" };
}

export async function POST(request: NextRequest) {
  let body: {
    accessToken?: string | null;
    application?: Record<string, unknown>;
    payment?: Record<string, unknown>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const application = body.application;
  const payment = body.payment;
  if (!application || typeof application !== "object") {
    return NextResponse.json(
      { error: "신청 정보가 필요합니다." },
      { status: 400 }
    );
  }

  const email = normalizeEmail(application.email);
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "이메일 형식을 확인해주세요." },
      { status: 400 }
    );
  }

  const expectedAmount = Number(payment?.expected_amount);
  if (payment && (!Number.isFinite(expectedAmount) || expectedAmount <= 0)) {
    return NextResponse.json(
      { error: "결제 금액을 다시 확인해주세요." },
      { status: 400 }
    );
  }

  // Derive user_id from the verified token only (never from the body).
  let safeUserId: string | null = null;
  const accessToken =
    typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  if (accessToken) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (supabaseUrl && supabaseAnonKey) {
      try {
        const authClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        });
        const {
          data: { user },
        } = await authClient.auth.getUser(accessToken);
        if (user && normalizeEmail(user.email) === email) {
          safeUserId = user.id;
        }
      } catch {
        // Invalid/expired token → store unlinked; linkExisting re-links later
      }
    }
  }

  try {
    const db = getSupabaseServiceRoleClient();
    const createdAt = new Date().toISOString();

    const applicationPayload: Record<string, unknown> = {
      user_id: safeUserId,
      email,
      status: "waiting_for_payment",
      created_at: createdAt,
    };
    for (const [key, value] of Object.entries(application)) {
      if (key === "email") continue;
      if (BASE_APPLICATION_FIELDS.has(key) || OPTIONAL_APPLICATION_FIELDS.has(key)) {
        applicationPayload[key] = sanitizeValue(value);
      }
    }

    const applicationResult = await insertWithColumnRetry(
      db,
      "applications",
      applicationPayload
    );

    if (!applicationResult.id) {
      console.warn(
        "[/api/applications/submit] application insert 실패:",
        JSON.stringify({ email, error: applicationResult.error })
      );
      return NextResponse.json(
        { applicationId: null, paymentId: null, error: "신청 정보를 저장하지 못했습니다." },
        { status: 500 }
      );
    }

    console.info(
      "[/api/applications/submit] application 저장:",
      JSON.stringify({
        applicationId: applicationResult.id,
        email,
        userId: safeUserId,
      })
    );

    let paymentId: string | null = null;
    let paymentError: string | null = null;
    if (payment && typeof payment === "object") {
      const paymentPayload: Record<string, unknown> = {
        application_id: applicationResult.id,
        expected_amount: expectedAmount,
        bank_name: sanitizeValue(payment.bank_name),
        account_number: sanitizeValue(payment.account_number),
        account_holder: sanitizeValue(payment.account_holder),
        depositor_name: sanitizeValue(payment.depositor_name),
        created_at: createdAt,
      };
      const paymentResult = await insertWithColumnRetry(
        db,
        "payments",
        paymentPayload
      );
      paymentId = paymentResult.id;
      paymentError = paymentResult.error;

      console.info(
        "[/api/applications/submit] payment 저장:",
        JSON.stringify({
          applicationId: applicationResult.id,
          paymentId,
          amount: expectedAmount,
          hasError: Boolean(paymentError),
        })
      );
    }

    return NextResponse.json({
      applicationId: applicationResult.id,
      paymentId,
      error: paymentError,
    });
  } catch (error) {
    console.error("[/api/applications/submit] failed:", error);
    return NextResponse.json(
      { applicationId: null, paymentId: null, error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
