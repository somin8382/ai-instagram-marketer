import { NextResponse } from "next/server";
import { INTERNAL_TEST_SESSION_COOKIE_NAME } from "@/lib/server/internal-test-session";

export async function POST() {
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
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}
