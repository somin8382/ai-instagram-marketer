import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// PATCH /api/admin/users/email — change a user's email.
//   - Signed-up user (userId present): updates the auth login email
//     (auth.users, confirmed immediately) + profiles.email, and re-points any
//     matching service_grants so pre-registration benefits stay linked.
//   - Pre-registered / 미가입 user (no userId): updates service_grants.email.
export async function PATCH(request: NextRequest) {
  const adminResult = await assertAdmin(extractBearerToken(request));
  if (!adminResult.ok) {
    return NextResponse.json({}, { status: adminResult.status });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const currentEmail =
    typeof body.currentEmail === "string" ? body.currentEmail.trim() : "";
  const newEmailRaw =
    typeof body.newEmail === "string" ? body.newEmail.trim() : "";
  const newEmail = newEmailRaw.toLowerCase();

  if (!newEmailRaw || !EMAIL_RE.test(newEmail)) {
    return NextResponse.json(
      { error: "올바른 이메일 형식이 아닙니다." },
      { status: 400 }
    );
  }
  if (!userId && !currentEmail) {
    return NextResponse.json(
      { error: "대상 사용자 정보가 없습니다." },
      { status: 400 }
    );
  }
  if (currentEmail && currentEmail.toLowerCase() === newEmail) {
    return NextResponse.json(
      { error: "기존 이메일과 동일합니다." },
      { status: 400 }
    );
  }

  try {
    const db = getSupabaseServiceRoleClient();
    let warning: string | undefined;

    // Re-point any pre-registration grant with the old email so benefits stay
    // linked to this person. Shared by both paths. Best-effort: the unique
    // index on lower(email) can reject if a grant already uses the new email.
    async function repointGrants() {
      if (!currentEmail) return;
      const res = (await (
        db
          .from("service_grants")
          .update({ email: newEmail } as never)
          .ilike("email", currentEmail) as unknown
      )) as { error: { message: string } | null };
      if (res.error) {
        warning =
          "이메일은 변경됐지만 사전등록(grant) 이메일 연결은 갱신하지 못했습니다. (이미 같은 이메일의 사전등록이 있을 수 있음)";
      }
    }

    if (userId) {
      // ── Signed-up user: change the auth login email (confirmed) ──
      const { error: authErr } = await db.auth.admin.updateUserById(userId, {
        email: newEmail,
        email_confirm: true,
      });
      if (authErr) {
        const msg = `${authErr.message} ${
          (authErr as { code?: string }).code ?? ""
        }`.toLowerCase();
        const already =
          msg.includes("already") ||
          msg.includes("registered") ||
          msg.includes("exists") ||
          msg.includes("duplicate") ||
          msg.includes("in use") ||
          msg.includes("unique") ||
          msg.includes("23505");
        return NextResponse.json(
          {
            error: already
              ? "이미 다른 계정에서 사용 중인 이메일입니다."
              : "이메일 변경에 실패했습니다.",
          },
          { status: already ? 409 : 500 }
        );
      }

      const profRes = (await (
        db
          .from("profiles")
          .update({ email: newEmail } as never)
          .eq("id", userId) as unknown
      )) as { error: { message: string } | null };
      if (profRes.error) {
        // Auth already changed; surface as a warning rather than failing.
        warning =
          "로그인 이메일은 변경됐지만 프로필 이메일 갱신은 실패했습니다.";
      }

      await repointGrants();
      return NextResponse.json({ ok: true, newEmail, warning });
    }

    // ── Pre-registered (grant-only) user: update the grant email ──
    const res = (await (
      db
        .from("service_grants")
        .update({ email: newEmail } as never)
        .ilike("email", currentEmail)
        .select("id") as unknown
    )) as { data: Array<{ id: string }> | null; error: { message: string } | null };

    if (res.error) {
      const already =
        res.error.message.toLowerCase().includes("duplicate") ||
        res.error.message.includes("service_grants_email_lower_idx");
      return NextResponse.json(
        {
          error: already
            ? "이미 등록된 이메일입니다."
            : "이메일 변경에 실패했습니다.",
        },
        { status: already ? 409 : 500 }
      );
    }
    if (!res.data || res.data.length === 0) {
      return NextResponse.json(
        { error: "대상 사전등록을 찾지 못했습니다." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, newEmail });
  } catch (error) {
    console.error("[/api/admin/users/email] failed:", error);
    return NextResponse.json(
      { error: "이메일 변경 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
