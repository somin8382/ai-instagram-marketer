export const TEST_ACCOUNT_NAME = "체험 계정";
export const TEST_ACCOUNT_USER_ID = "mock-user-test";
export const TEST_ACCOUNT_EMAIL = "user-test@gmail.com";
export const TEST_ACCOUNT_PASSWORD = "aSDfjd1@";
export const TEST_ACCOUNT_AUTH_ID = TEST_ACCOUNT_EMAIL;
const TEST_ACCOUNT_LEGACY_AUTH_ID = "internal-test-account";
const TEST_ACCOUNT_ACCESS_STORAGE_KEY = "qmeet-test-account-access";

export const TEST_ACCOUNT_DEFAULT_PLAN = 2;
export const TEST_ACCOUNT_DEFAULT_DURATION = 1;
export const TEST_ACCOUNT_DEFAULT_REMAINING_POSTS = 4;

function setLocalTestAccountAccess(active: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  if (active) {
    window.localStorage.setItem(TEST_ACCOUNT_ACCESS_STORAGE_KEY, "true");
    return;
  }

  window.localStorage.removeItem(TEST_ACCOUNT_ACCESS_STORAGE_KEY);
}

function hasLocalTestAccountAccess() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(TEST_ACCOUNT_ACCESS_STORAGE_KEY) === "true";
}

export async function requestInternalTestLogin(input: {
  id: string;
  password: string;
}) {
  const normalizedId = input.id.trim().toLowerCase();
  const normalizedPassword = input.password.trim();
  const isHardcodedTestCredential =
    normalizedId === TEST_ACCOUNT_EMAIL.toLowerCase() &&
    normalizedPassword === TEST_ACCOUNT_PASSWORD;

  try {
    const response = await fetch("/api/internal-test-login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: normalizedId,
        password: normalizedPassword,
      }),
    });

    if (!response.ok) {
      return { success: false as const };
    }

    const data = (await response.json()) as { success?: boolean };
    const success = Boolean(data.success);

    if (success) {
      setLocalTestAccountAccess(true);
    }

    return { success };
  } catch {
    // Keep local-only fallback for fast local development.
    // In production, require server session issuance so API routes can verify it.
    if (
      process.env.NODE_ENV !== "production" &&
      isHardcodedTestCredential
    ) {
      setLocalTestAccountAccess(true);
      return { success: true as const };
    }

    return { success: false as const };
  }
}

export async function fetchTestAccountAccess() {
  // In production we must validate the signed server session cookie.
  // Local storage alone is not enough for API authorization checks.
  if (
    process.env.NODE_ENV !== "production" &&
    hasLocalTestAccountAccess()
  ) {
    return true;
  }

  try {
    const response = await fetch("/api/internal-test-session", {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as { active?: boolean };
    const active = Boolean(data.active);

    if (active) {
      setLocalTestAccountAccess(true);
      return true;
    }

    setLocalTestAccountAccess(false);
    return false;
  } catch {
    if (
      process.env.NODE_ENV !== "production" &&
      hasLocalTestAccountAccess()
    ) {
      return true;
    }

    return false;
  }
}

export async function clearTestAccountAccess() {
  setLocalTestAccountAccess(false);

  try {
    await fetch("/api/internal-test-logout", {
      method: "POST",
    });
  } catch {
    // Ignore network errors on logout.
  }
}

export function isTestAccountUser(
  userId?: string | null,
  authId?: string | null
) {
  const normalizedAuthId = (authId ?? "").trim().toLowerCase();

  return (
    (userId ?? "").trim() === TEST_ACCOUNT_USER_ID ||
    normalizedAuthId === TEST_ACCOUNT_AUTH_ID.toLowerCase() ||
    normalizedAuthId === TEST_ACCOUNT_LEGACY_AUTH_ID
  );
}
