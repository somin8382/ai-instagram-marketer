import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceRoleClient } from "@/lib/server/admin";
import { verifyUnsubscribeToken } from "@/lib/server/outreach";

// Public, no-auth email unsubscribe. The signed token identifies the email;
// no login needed (recipients aren't necessarily users). Records an opt-out
// for the 'email' channel; the send path skips opted-out addresses.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const email = verifyUnsubscribeToken(token);

  if (!email) {
    return NextResponse.redirect(new URL("/unsubscribe?status=invalid", request.url));
  }

  try {
    const db = getSupabaseServiceRoleClient();
    // Idempotent: only insert if not already opted out for email.
    const existing = (await (
      db
        .from("outreach_optouts")
        .select("id")
        .eq("channel", "email")
        .ilike("email", email)
        .limit(1)
        .maybeSingle() as unknown
    )) as { data: { id: string } | null; error: { message: string } | null };

    if (!existing.data) {
      await (
        db.from("outreach_optouts").insert({
          channel: "email",
          email,
          source: "unsubscribe_link",
        } as never) as unknown as Promise<unknown>
      );
    }
    return NextResponse.redirect(new URL("/unsubscribe?status=ok", request.url));
  } catch (error) {
    console.error("[/api/outreach/unsubscribe] failed:", error);
    return NextResponse.redirect(new URL("/unsubscribe?status=error", request.url));
  }
}
