import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const INTERNAL_TEST_SESSION_COOKIE_NAME = "qmeet_internal_test_session";
export const INTERNAL_TEST_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const DEFAULT_INTERNAL_TEST_ACCOUNT_ID = "user-test@gmail.com";
const DEFAULT_INTERNAL_TEST_ACCOUNT_PASSWORD = "aSDfjd1@";
const DEFAULT_INTERNAL_TEST_ACCOUNT_SECRET =
  "qmeet-internal-test-account-secret-v1";

type InternalTestSessionPayload = {
  id: string;
  issuedAt: number;
};

function isInternalTestAccountFeatureEnabled() {
  const raw = process.env.INTERNAL_TEST_ACCOUNT_ENABLED?.trim().toLowerCase();

  // Enabled by default so the built-in test account works on deployed environments
  // unless it is explicitly disabled.
  if (raw === "false") {
    return false;
  }

  return true;
}

function getInternalTestAccountId() {
  return (
    process.env.INTERNAL_TEST_ACCOUNT_ID?.trim() ??
    DEFAULT_INTERNAL_TEST_ACCOUNT_ID
  );
}

function getInternalTestAccountPassword() {
  return (
    process.env.INTERNAL_TEST_ACCOUNT_PASSWORD?.trim() ??
    DEFAULT_INTERNAL_TEST_ACCOUNT_PASSWORD
  );
}

function getInternalTestSecret() {
  return (
    process.env.INTERNAL_TEST_ACCOUNT_SECRET?.trim() ??
    DEFAULT_INTERNAL_TEST_ACCOUNT_SECRET
  );
}

function encodePayload(payload: InternalTestSessionPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(value: string) {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as InternalTestSessionPayload;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.id !== "string" ||
      !parsed.id.trim() ||
      typeof parsed.issuedAt !== "number" ||
      !Number.isFinite(parsed.issuedAt)
    ) {
      return null;
    }

    return {
      id: parsed.id.trim(),
      issuedAt: parsed.issuedAt,
    };
  } catch {
    return null;
  }
}

function signPayload(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function isSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function isInternalTestAccountEnabled() {
  return (
    isInternalTestAccountFeatureEnabled() &&
    !!getInternalTestAccountId() &&
    !!getInternalTestAccountPassword() &&
    !!getInternalTestSecret()
  );
}

export function verifyInternalTestCredentials(id: string, password: string) {
  if (!isInternalTestAccountEnabled()) {
    return false;
  }

  const normalizedId = id.trim().toLowerCase();
  const normalizedPassword = password.trim();
  const expectedId = getInternalTestAccountId().toLowerCase();
  const expectedPassword = getInternalTestAccountPassword();
  const matchesConfigured =
    normalizedId === expectedId && normalizedPassword === expectedPassword;
  const matchesDefault =
    normalizedId === DEFAULT_INTERNAL_TEST_ACCOUNT_ID.toLowerCase() &&
    normalizedPassword === DEFAULT_INTERNAL_TEST_ACCOUNT_PASSWORD;

  return matchesConfigured || matchesDefault;
}

export function createInternalTestSessionToken(sessionId: string) {
  const secret = getInternalTestSecret();

  if (!secret) {
    return null;
  }

  const payload = encodePayload({
    id: sessionId.trim(),
    issuedAt: Date.now(),
  });
  const signature = signPayload(payload, secret);

  return `${payload}.${signature}`;
}

export function verifyInternalTestSessionToken(token?: string | null) {
  if (!token || !isInternalTestAccountEnabled()) {
    return { valid: false as const, id: null as string | null };
  }

  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return { valid: false as const, id: null as string | null };
  }

  const secret = getInternalTestSecret();
  const expectedSignature = signPayload(encodedPayload, secret);

  if (!isSafeEqual(signature, expectedSignature)) {
    return { valid: false as const, id: null as string | null };
  }

  const payload = decodePayload(encodedPayload);

  if (!payload) {
    return { valid: false as const, id: null as string | null };
  }

  const isExpired =
    Date.now() - payload.issuedAt > INTERNAL_TEST_SESSION_MAX_AGE_SECONDS * 1000;

  if (isExpired) {
    return { valid: false as const, id: null as string | null };
  }

  return { valid: true as const, id: payload.id };
}
