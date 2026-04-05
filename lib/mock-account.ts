export const TEST_ACCOUNT_NAME = "체험 계정";
export const TEST_ACCOUNT_USER_ID = "mock-user-test";
export const TEST_ACCOUNT_AUTH_ID = "internal-test-account";

export const TEST_ACCOUNT_DEFAULT_PLAN = 2;
export const TEST_ACCOUNT_DEFAULT_DURATION = 1;
export const TEST_ACCOUNT_DEFAULT_REMAINING_POSTS = 4;

export async function requestInternalTestLogin(input: {
  id: string;
  password: string;
}) {
  try {
    const response = await fetch("/api/internal-test-login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: input.id.trim(),
        password: input.password.trim(),
      }),
    });

    if (!response.ok) {
      return { success: false as const };
    }

    const data = (await response.json()) as { success?: boolean };
    return { success: Boolean(data.success) };
  } catch {
    return { success: false as const };
  }
}

export async function fetchTestAccountAccess() {
  try {
    const response = await fetch("/api/internal-test-session", {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as { active?: boolean };
    return Boolean(data.active);
  } catch {
    return false;
  }
}

export async function clearTestAccountAccess() {
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
  return (
    (userId ?? "").trim() === TEST_ACCOUNT_USER_ID ||
    (authId ?? "").trim().toLowerCase() === TEST_ACCOUNT_AUTH_ID
  );
}
