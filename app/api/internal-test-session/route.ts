import { NextResponse } from "next/server";
import {
  INTERNAL_TEST_SESSION_COOKIE_NAME,
  isInternalTestAccountEnabled,
  verifyInternalTestSessionToken,
} from "@/lib/server/internal-test-session";

export async function GET(request: Request) {
  if (!isInternalTestAccountEnabled()) {
    return NextResponse.json(
      { active: false },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const sessionCookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${INTERNAL_TEST_SESSION_COOKIE_NAME}=`));
  const token = sessionCookie?.slice(`${INTERNAL_TEST_SESSION_COOKIE_NAME}=`.length) ?? "";
  const verification = verifyInternalTestSessionToken(token);

  return NextResponse.json(
    { active: verification.valid },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
