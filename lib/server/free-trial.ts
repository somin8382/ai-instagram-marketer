import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getSupabaseServiceRoleClient } from "@/lib/server/admin";
import { getKoreaDateString } from "@/lib/post-generator/subscription";

const USAGE_TABLE = "anonymous_free_trial_usage";
const IP_WINDOW_MS = 24 * 60 * 60 * 1000;

const COOKIE_NAME = "qmeet_free_trial";
// The "trial consumed" marker should persist ~indefinitely per browser.
// 400 days is the max a browser will honor for a cookie Max-Age.
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

// ── Central, env-overridable configuration ────────────────────────────────────
// Both limits can be tuned per environment without a code change. Defaults are
// deliberately loose for the per-IP limit (CGNAT/shared-IP reality) since the
// signed cookie — not the IP — is the primary per-visitor gate.
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getFreeTrialConfig() {
  return {
    /** Secondary abuse guard: max anonymous trials per IP per rolling 24h. */
    maxPerIpPerDay: envInt("FREE_TRIAL_MAX_PER_IP_PER_DAY", 30),
    /** Final cost cap: max anonymous trials across all visitors per Korea day. */
    globalDailyBudget: envInt("FREE_TRIAL_GLOBAL_DAILY_BUDGET", 500),
  };
}

// ── Signed cookie (primary per-visitor gate) ──────────────────────────────────
function getCookieSecret(): string {
  return (
    process.env.FREE_TRIAL_COOKIE_SECRET ??
    process.env.INTERNAL_TEST_ACCOUNT_SECRET ??
    "qmeet-free-trial-cookie-secret-v1"
  );
}

function sign(value: string): string {
  return createHmac("sha256", getCookieSecret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function readCookie(cookieHeader: string, name: string): string {
  const item = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : "";
}

function hasConsumedCookie(request: Request): boolean {
  const raw = readCookie(request.headers.get("cookie") ?? "", COOKIE_NAME);
  if (!raw) {
    return false;
  }
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) {
    return false;
  }
  return safeEqual(signature, sign(payload));
}

/** Set-Cookie header value marking this browser as having consumed its trial. */
export function buildConsumedCookieHeader(): string {
  const payload = Buffer.from(
    JSON.stringify({ v: 1, t: Date.now() })
  ).toString("base64url");
  const value = `${payload}.${sign(payload)}`;

  const parts = [
    `${COOKIE_NAME}=${value}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

// ── IP handling ───────────────────────────────────────────────────────────────
function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  if (first) {
    return first;
  }
  return request.headers.get("x-real-ip")?.trim() ?? "";
}

function hashIp(ip: string): string {
  // Hashing is for privacy (never store a raw IP), not authentication.
  const salt =
    process.env.FREE_TRIAL_IP_SALT ??
    process.env.INTERNAL_TEST_ACCOUNT_SECRET ??
    "qmeet-free-trial-ip-salt-v1";
  return createHmac("sha256", salt).update(ip).digest("hex");
}

function startOfKoreaDayIso(): string {
  // getKoreaDateString() is YYYY-MM-DD in KST; anchor to KST midnight.
  return new Date(`${getKoreaDateString()}T00:00:00+09:00`).toISOString();
}

type Decision =
  | { ok: true; setCookieHeader: string }
  | { ok: false; error: string; statusCode: number };

const ALREADY_USED_MESSAGE =
  "이미 무료 체험을 이용하셨습니다. 회원가입 후 계속 이용해주세요.";
const IP_LIMIT_MESSAGE =
  "무료 체험 횟수를 초과했습니다. 회원가입 후 이용해주세요.";
const GLOBAL_BUDGET_MESSAGE =
  "지금은 무료 체험 이용자가 많습니다. 잠시 후 다시 시도하시거나 회원가입 후 바로 이용해주세요.";

/**
 * Layered gate for the anonymous (no-account) free trial, evaluated before any
 * OpenRouter call:
 *   1. Signed HttpOnly cookie — primary per-visitor gate (works without the DB).
 *   2. Global daily budget — final cost cap; logs for administrators when hit.
 *   3. Per-IP rolling limit — secondary automated-abuse guard.
 * On success it reserves the trial (one usage row) and returns the Set-Cookie
 * header the caller must attach to the successful generation response.
 *
 * Fails open on any DB/infra error (availability first for a free feature); the
 * cookie layer still functions since it needs no database.
 */
export async function evaluateAnonymousFreeTrial(
  request: Request
): Promise<Decision> {
  // Layer 1 — cookie (no DB dependency).
  if (hasConsumedCookie(request)) {
    console.info("[/api/ai] Free trial blocked: cookie (already consumed)");
    return { ok: false, error: ALREADY_USED_MESSAGE, statusCode: 403 };
  }

  const setCookieHeader = buildConsumedCookieHeader();

  let db;
  try {
    db = getSupabaseServiceRoleClient();
  } catch {
    // Service role not configured (e.g. local dev): keep the cookie gate, skip
    // the DB-backed budget/IP layers.
    console.warn(
      "[/api/ai] Free trial: service role unavailable; DB limits skipped"
    );
    return { ok: true, setCookieHeader };
  }

  const config = getFreeTrialConfig();

  // Layer 2 — global daily budget (final cost cap).
  const globalResponse = (await ((
    db
      .from(USAGE_TABLE as never)
      .select("id", { count: "exact", head: true })
      .gte("used_at", startOfKoreaDayIso()) as unknown
  ) as Promise<{ count: number | null; error: { message: string } | null }>));

  if (globalResponse.error) {
    console.error(
      "[/api/ai] Free trial global budget check failed:",
      globalResponse.error.message
    );
    return { ok: true, setCookieHeader };
  }

  const globalCount = globalResponse.count ?? 0;
  if (globalCount >= config.globalDailyBudget) {
    console.error(
      "[/api/ai][ADMIN] Free trial global daily budget reached:",
      JSON.stringify({
        date: getKoreaDateString(),
        count: globalCount,
        budget: config.globalDailyBudget,
      })
    );
    return { ok: false, error: GLOBAL_BUDGET_MESSAGE, statusCode: 503 };
  }

  // Layer 3 — per-IP rolling limit (secondary abuse guard).
  const ip = getClientIp(request);
  const ipHash = ip ? hashIp(ip) : "";

  if (ipHash) {
    const ipResponse = (await ((
      db
        .from(USAGE_TABLE as never)
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("used_at", new Date(Date.now() - IP_WINDOW_MS).toISOString()) as unknown
    ) as Promise<{ count: number | null; error: { message: string } | null }>));

    if (ipResponse.error) {
      console.error(
        "[/api/ai] Free trial IP check failed:",
        ipResponse.error.message
      );
      return { ok: true, setCookieHeader };
    }

    if ((ipResponse.count ?? 0) >= config.maxPerIpPerDay) {
      console.warn(
        "[/api/ai] Free trial blocked: ip limit",
        JSON.stringify({
          ipHashPrefix: ipHash.slice(0, 8),
          count: ipResponse.count ?? 0,
          limit: config.maxPerIpPerDay,
        })
      );
      return { ok: false, error: IP_LIMIT_MESSAGE, statusCode: 429 };
    }
  }

  // Reserve the trial before generation so concurrent requests are counted
  // against both the global budget and the per-IP limit.
  const insertResponse = (await ((
    db
      .from(USAGE_TABLE as never)
      .insert({ ip_hash: ipHash } as never) as unknown
  ) as Promise<{ error: { message: string } | null }>));

  if (insertResponse.error) {
    console.error(
      "[/api/ai] Free trial reserve failed:",
      insertResponse.error.message
    );
    // Fail open; the checks above already bound sustained abuse.
  }

  return { ok: true, setCookieHeader };
}
