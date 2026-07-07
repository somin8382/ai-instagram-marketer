import "server-only";

import { createHmac } from "node:crypto";
import { getSupabaseServiceRoleClient } from "@/lib/server/admin";
import { getKoreaDateString } from "@/lib/post-generator/subscription";

// Generic per-IP (rolling 24h) + global daily rate limiter, mirroring the
// anonymous free-trial gate's machinery. Each accepted event inserts one row
// into the given usage table, keyed by a hashed IP (never a raw IP).
//
// Fails OPEN on any DB/infra error: a limiter must not take down the feature
// it guards. Callers reserve on success by default.

const IP_WINDOW_MS = 24 * 60 * 60 * 1000;

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  if (first) return first;
  return request.headers.get("x-real-ip")?.trim() ?? "";
}

function hashIp(ip: string): string {
  // Privacy only (never store a raw IP), not authentication.
  const salt =
    process.env.RATE_LIMIT_IP_SALT ??
    process.env.FREE_TRIAL_IP_SALT ??
    process.env.INTERNAL_TEST_ACCOUNT_SECRET ??
    "qmeet-rate-limit-ip-salt-v1";
  return createHmac("sha256", salt).update(ip).digest("hex");
}

function startOfKoreaDayIso(): string {
  return new Date(`${getKoreaDateString()}T00:00:00+09:00`).toISOString();
}

export type RateLimitDecision =
  | { ok: true }
  | { ok: false; reason: "ip" | "global"; statusCode: number };

export async function checkAndReserveRateLimit(input: {
  request: Request;
  table: string;
  perIpPerDay: number;
  globalDaily: number;
  logTag: string;
}): Promise<RateLimitDecision> {
  const { request, table, perIpPerDay, globalDaily, logTag } = input;

  let db;
  try {
    db = getSupabaseServiceRoleClient();
  } catch {
    // Service role unavailable (e.g. local dev without the key): fail open.
    console.warn(`[${logTag}] rate limit: service role unavailable; skipped`);
    return { ok: true };
  }

  // Layer 1 — global daily cap (final abuse/cost ceiling).
  const globalRes = (await (
    db
      .from(table as never)
      .select("id", { count: "exact", head: true })
      .gte("used_at", startOfKoreaDayIso()) as unknown
  )) as { count: number | null; error: { message: string } | null };

  if (globalRes.error) {
    console.error(`[${logTag}] rate limit global check failed:`, globalRes.error.message);
    return { ok: true };
  }
  if ((globalRes.count ?? 0) >= globalDaily) {
    console.error(
      `[${logTag}][ADMIN] global daily submission cap reached:`,
      JSON.stringify({ date: getKoreaDateString(), count: globalRes.count, cap: globalDaily })
    );
    return { ok: false, reason: "global", statusCode: 503 };
  }

  // Layer 2 — per-IP rolling 24h limit.
  const ip = getClientIp(request);
  const ipHash = ip ? hashIp(ip) : "";
  if (ipHash) {
    const ipRes = (await (
      db
        .from(table as never)
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("used_at", new Date(Date.now() - IP_WINDOW_MS).toISOString()) as unknown
    )) as { count: number | null; error: { message: string } | null };

    if (ipRes.error) {
      console.error(`[${logTag}] rate limit IP check failed:`, ipRes.error.message);
      return { ok: true };
    }
    if ((ipRes.count ?? 0) >= perIpPerDay) {
      console.warn(
        `[${logTag}] rate limit blocked: ip`,
        JSON.stringify({ ipHashPrefix: ipHash.slice(0, 8), count: ipRes.count, limit: perIpPerDay })
      );
      return { ok: false, reason: "ip", statusCode: 429 };
    }
  }

  // Reserve before the work so concurrent requests count against both limits.
  const insertRes = (await (
    db.from(table as never).insert({ ip_hash: ipHash } as never) as unknown
  )) as { error: { message: string } | null };
  if (insertRes.error) {
    console.error(`[${logTag}] rate limit reserve failed:`, insertRes.error.message);
    // Fail open; the checks above already bound sustained abuse.
  }

  return { ok: true };
}
