import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";
import {
  channelConfigured,
  composeEmail,
  composeSms,
  renderTemplate,
  sendAlimtalk,
  sendEmail,
  sendSms,
  type OutreachCategory,
  type OutreachChannel,
  type Recipient,
} from "@/lib/server/outreach";

export const maxDuration = 60;

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

const MAX_RECIPIENTS = 2000;
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// GET /api/admin/outreach — recent campaigns + their per-recipient sends.
export async function GET(request: NextRequest) {
  const adminResult = await assertAdmin(extractBearerToken(request));
  if (!adminResult.ok) return NextResponse.json({}, { status: adminResult.status });

  try {
    const db = getSupabaseServiceRoleClient();
    const [messagesRes, optoutsRes] = await Promise.all([
      (db
        .from("outreach_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50) as unknown) as Promise<{
        data: Array<Record<string, unknown>> | null;
        error: { message: string } | null;
      }>,
      (db
        .from("outreach_optouts")
        .select("email, phone")
        .limit(10000) as unknown) as Promise<{
        data: Array<{ email: string | null; phone: string | null }> | null;
        error: { message: string } | null;
      }>,
    ]);

    const config = {
      email: channelConfigured("email"),
      sms: channelConfigured("sms"),
      alimtalk: channelConfigured("alimtalk"),
    };

    // Opt-out contacts so the picker can mark/exclude them before sending.
    const optOutEmails: string[] = [];
    const optOutPhones: string[] = [];
    for (const o of optoutsRes.data ?? []) {
      if (o.email) optOutEmails.push(o.email.trim().toLowerCase());
      if (o.phone) optOutPhones.push(o.phone.replace(/[^0-9]/g, ""));
    }

    if (messagesRes.error) {
      // Table may be missing pre-migration — return empty, still report config.
      return NextResponse.json({ messages: [], config, optOutEmails, optOutPhones });
    }
    return NextResponse.json({
      messages: messagesRes.data ?? [],
      config,
      optOutEmails,
      optOutPhones,
    });
  } catch (error) {
    console.error("[/api/admin/outreach] GET failed:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

// POST /api/admin/outreach — send a campaign to an admin-curated recipient list.
export async function POST(request: NextRequest) {
  const adminResult = await assertAdmin(extractBearerToken(request));
  if (!adminResult.ok) return NextResponse.json({}, { status: adminResult.status });

  let body: {
    channel?: string;
    category?: string;
    subject?: string;
    body?: string;
    recipients?: Recipient[];
    test?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  // Test mode: send to a single address without logging a campaign or applying
  // opt-out/dedupe (the admin is testing their own copy).
  const isTest = body.test === true;
  const channel = (["email", "sms", "alimtalk"].includes(String(body.channel))
    ? body.channel
    : "") as OutreachChannel | "";
  const category = (body.category === "ad" ? "ad" : "notice") as OutreachCategory;
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const messageBody = typeof body.body === "string" ? body.body.trim() : "";
  const recipients = Array.isArray(body.recipients) ? body.recipients : [];

  if (!channel) return NextResponse.json({ error: "채널을 선택해주세요." }, { status: 400 });
  if (!messageBody) return NextResponse.json({ error: "본문을 입력해주세요." }, { status: 400 });
  if (channel === "email" && !subject) {
    return NextResponse.json({ error: "이메일 제목을 입력해주세요." }, { status: 400 });
  }
  if (recipients.length === 0) {
    return NextResponse.json({ error: "수신자를 선택해주세요." }, { status: 400 });
  }
  if (isTest && recipients.length > 3) {
    return NextResponse.json(
      { error: "테스트 발송은 최대 3명까지 가능합니다." },
      { status: 400 }
    );
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json(
      { error: `한 번에 최대 ${MAX_RECIPIENTS}명까지 발송할 수 있습니다.` },
      { status: 400 }
    );
  }
  if (!channelConfigured(channel)) {
    return NextResponse.json(
      {
        error:
          channel === "email"
            ? "이메일 발송이 아직 설정되지 않았습니다. (OUTREACH_SMTP_PASS 필요)"
            : channel === "sms"
              ? "SMS 발송이 아직 설정되지 않았습니다. (Solapi 키/발신번호 필요)"
              : "알림톡 발송이 아직 설정되지 않았습니다. (Solapi + 승인된 템플릿 필요)",
        providerNotConfigured: true,
      },
      { status: 503 }
    );
  }

  // Test send: fire to each address immediately, no DB campaign/log, no
  // opt-out/dedupe. Returns per-recipient outcome for inline display.
  if (isTest) {
    const results = await Promise.all(
      recipients.map(async (r) => {
        const email = (r.email ?? "").trim().toLowerCase();
        const phone = (r.phone ?? "").replace(/[^0-9]/g, "");
        if (channel === "email") {
          if (!email) return { to: "", status: "failed", error: "이메일 없음" };
          const composed = composeEmail({ subject, body: messageBody, recipient: r, category });
          const res = await sendEmail({
            to: email,
            subject: composed.subject,
            text: composed.text,
            html: composed.html,
          });
          return { to: email, ...res };
        }
        if (!phone) return { to: "", status: "failed", error: "전화번호 없음" };
        const res =
          channel === "sms"
            ? await sendSms({ to: phone, text: composeSms({ body: messageBody, recipient: r, category }) })
            : await sendAlimtalk({ to: phone, text: renderTemplate(messageBody, r) });
        return { to: phone, ...res };
      })
    );
    const okCount = results.filter((x) => x.status === "sent").length;
    return NextResponse.json({ ok: true, test: true, results, sent: okCount });
  }

  const db = getSupabaseServiceRoleClient();

  // Load opt-outs once; skip anyone who opted out of this channel (or 'all').
  const optRes = (await (
    db
      .from("outreach_optouts")
      .select("email, phone, channel")
      .or(`channel.eq.${channel},channel.eq.all`) as unknown
  )) as {
    data: Array<{ email: string | null; phone: string | null; channel: string }> | null;
    error: { message: string } | null;
  };
  const optEmails = new Set<string>();
  const optPhones = new Set<string>();
  for (const o of optRes.data ?? []) {
    if (o.email) optEmails.add(o.email.trim().toLowerCase());
    if (o.phone) optPhones.add(o.phone.replace(/[^0-9]/g, ""));
  }

  // Create the campaign row up front so the id anchors the send log.
  const msgRes = (await (
    db
      .from("outreach_messages")
      .insert({
        channel,
        category,
        subject: channel === "email" ? subject : null,
        body: messageBody,
        created_by: adminResult.email,
        total: recipients.length,
      } as never)
      .select("id")
      .single() as unknown
  )) as { data: { id: string } | null; error: { message: string } | null };

  if (msgRes.error || !msgRes.data) {
    return NextResponse.json({ error: "발송 기록 생성에 실패했습니다." }, { status: 500 });
  }
  const messageId = msgRes.data.id;

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const seen = new Set<string>();
  const sendRows: Array<Record<string, unknown>> = [];

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (r) => {
        const email = (r.email ?? "").trim().toLowerCase();
        const phone = (r.phone ?? "").replace(/[^0-9]/g, "");
        const dedupeKey = channel === "email" ? email : phone;

        const base = {
          message_id: messageId,
          channel,
          recipient_email: email || null,
          recipient_phone: phone || null,
          recipient_name: r.name ?? null,
        };

        // Missing contact / duplicate / opted-out → skip (logged).
        const missing = channel === "email" ? !email : !phone;
        const optedOut =
          channel === "email" ? optEmails.has(email) : optPhones.has(phone);
        if (missing || !dedupeKey || seen.has(dedupeKey) || optedOut) {
          skipped += 1;
          sendRows.push({
            ...base,
            status: "skipped",
            error: missing
              ? "연락처 없음"
              : seen.has(dedupeKey)
                ? "중복"
                : "수신거부",
          });
          return;
        }
        seen.add(dedupeKey);

        let result;
        if (channel === "email") {
          const composed = composeEmail({ subject, body: messageBody, recipient: r, category });
          result = await sendEmail({
            to: email,
            subject: composed.subject,
            text: composed.text,
            html: composed.html,
          });
        } else if (channel === "sms") {
          result = await sendSms({ to: phone, text: composeSms({ body: messageBody, recipient: r, category }) });
        } else {
          result = await sendAlimtalk({ to: phone, text: renderTemplate(messageBody, r) });
        }

        if (result.status === "sent") {
          sent += 1;
          sendRows.push({ ...base, status: "sent" });
        } else {
          failed += 1;
          sendRows.push({ ...base, status: "failed", error: result.error.slice(0, 500) });
        }
      })
    );
    if (i + BATCH_SIZE < recipients.length) await sleep(BATCH_DELAY_MS);
  }

  // Persist per-recipient log + rollup counts.
  if (sendRows.length > 0) {
    await (db.from("outreach_sends").insert(sendRows as never) as unknown as Promise<unknown>);
  }
  await (
    db
      .from("outreach_messages")
      .update({ sent, failed, skipped } as never)
      .eq("id", messageId) as unknown as Promise<unknown>
  );

  console.info(
    "[/api/admin/outreach] campaign sent:",
    JSON.stringify({ messageId, channel, category, sent, failed, skipped, by: adminResult.email })
  );
  return NextResponse.json({ ok: true, messageId, total: recipients.length, sent, failed, skipped });
}
