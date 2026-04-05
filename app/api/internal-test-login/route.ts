import { NextResponse } from "next/server";
import {
  createInternalTestSessionToken,
  INTERNAL_TEST_SESSION_COOKIE_NAME,
  INTERNAL_TEST_SESSION_MAX_AGE_SECONDS,
  isInternalTestAccountEnabled,
  verifyInternalTestCredentials,
} from "@/lib/server/internal-test-session";

export async function POST(request: Request) {
  if (!isInternalTestAccountEnabled()) {
    return NextResponse.json(
      { success: false, error: "요청 정보를 확인해주세요." },
      { status: 404 }
    );
  }

  let body: { id?: string; password?: string };

  try {
    body = (await request.json()) as { id?: string; password?: string };
  } catch {
    return NextResponse.json(
      { success: false, error: "요청 정보를 확인해주세요." },
      { status: 400 }
    );
  }

  const id = String(body.id ?? "").trim();
  const password = String(body.password ?? "").trim();

  if (!id || !password) {
    return NextResponse.json(
      { success: false, error: "아이디(이메일) 또는 비밀번호가 올바르지 않습니다." },
      { status: 401 }
    );
  }

  if (!verifyInternalTestCredentials(id, password)) {
    return NextResponse.json(
      { success: false, error: "아이디(이메일) 또는 비밀번호가 올바르지 않습니다." },
      { status: 401 }
    );
  }

  const sessionToken = createInternalTestSessionToken(
    process.env.INTERNAL_TEST_ACCOUNT_SESSION_ID ?? "internal-test"
  );

  if (!sessionToken) {
    return NextResponse.json(
      { success: false, error: "테스트 계정을 사용할 수 없습니다." },
      { status: 500 }
    );
  }

  const response = NextResponse.json(
    { success: true },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );

  response.cookies.set({
    name: INTERNAL_TEST_SESSION_COOKIE_NAME,
    value: sessionToken,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: INTERNAL_TEST_SESSION_MAX_AGE_SECONDS,
  });

  return response;
}
