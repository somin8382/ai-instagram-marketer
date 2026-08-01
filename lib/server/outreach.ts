import "server-only";

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";

// ── Channels ──────────────────────────────────────────────────────────────────
export type OutreachChannel = "email" | "sms" | "alimtalk";
export type OutreachCategory = "notice" | "ad";

export type Recipient = {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  company?: string | null;
};

export type SendResult =
  | { status: "sent" }
  | { status: "failed"; error: string };

// ── Template variables ────────────────────────────────────────────────────────
// {{name}}, {{company}} are substituted from the recipient record. Unknown
// variables collapse to an empty string so a missing field never leaks "{{x}}".
export function renderTemplate(
  template: string,
  recipient: Recipient
): string {
  const map: Record<string, string> = {
    name: (recipient.name ?? "").trim(),
    company: (recipient.company ?? "").trim(),
    email: (recipient.email ?? "").trim(),
  };
  return template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_, key: string) =>
    key in map ? map[key] : ""
  );
}

// ── Unsubscribe token (HMAC-signed, no DB row needed to validate) ──────────────
function unsubscribeSecret(): string {
  return (
    process.env.OUTREACH_UNSUBSCRIBE_SECRET ??
    process.env.INTERNAL_TEST_ACCOUNT_SECRET ??
    "qmeet-outreach-unsub-secret-v1"
  );
}

export function buildUnsubscribeToken(email: string): string {
  const payload = Buffer.from(
    JSON.stringify({ e: email.trim().toLowerCase(), t: Date.now() })
  ).toString("base64url");
  const sig = createHmac("sha256", unsubscribeSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const [payload, sig] = (token ?? "").split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", unsubscribeSecret())
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      e?: string;
    };
    return typeof parsed.e === "string" ? parsed.e : null;
  } catch {
    return null;
  }
}

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.OUTREACH_SITE_URL ||
    "https://www.useaimarketer.com"
  );
}

// ── Compose (variables + 광고 표기 + 무료수신거부) ─────────────────────────────
// Korea: advertising messages must carry a "(광고)" prefix and a free opt-out
// path (표시광고법 / 정보통신망법). 안내(notice) messages skip the (광고) label
// but email still gets an unsubscribe footer as good practice.
export function composeEmail(input: {
  subject: string;
  body: string;
  recipient: Recipient;
  category: OutreachCategory;
}): { subject: string; text: string; html: string } {
  const email = (input.recipient.email ?? "").trim();
  const subject =
    (input.category === "ad" ? "(광고) " : "") +
    renderTemplate(input.subject, input.recipient);
  const bodyText = renderTemplate(input.body, input.recipient);

  const unsubUrl = email
    ? `${siteUrl()}/api/outreach/unsubscribe?token=${encodeURIComponent(
        buildUnsubscribeToken(email)
      )}`
    : `${siteUrl()}/api/outreach/unsubscribe`;

  const footerText =
    input.category === "ad"
      ? `\n\n───\n본 메일은 광고성 정보입니다. 수신을 원치 않으시면 아래 링크에서 무료로 수신거부하실 수 있습니다.\n무료수신거부: ${unsubUrl}`
      : `\n\n───\n수신거부: ${unsubUrl}`;

  const escapeHtml = (s: string) =>
    s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
    );
  const bodyHtml = escapeHtml(bodyText).replace(/\n/g, "<br>");
  const footerHtml =
    input.category === "ad"
      ? `<hr style="margin:24px 0;border:none;border-top:1px solid #eee"><p style="font-size:12px;color:#888">본 메일은 광고성 정보입니다. <a href="${unsubUrl}">무료수신거부</a></p>`
      : `<hr style="margin:24px 0;border:none;border-top:1px solid #eee"><p style="font-size:12px;color:#888"><a href="${unsubUrl}">수신거부</a></p>`;

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans KR',sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#222;line-height:1.7">${bodyHtml}${footerHtml}</div>`;

  return { subject, text: bodyText + footerText, html };
}

export function composeSms(input: {
  body: string;
  recipient: Recipient;
  category: OutreachCategory;
}): string {
  const body = renderTemplate(input.body, input.recipient);
  if (input.category === "ad") {
    // (광고) prefix + free opt-out line. The 무료거부 number is provider-issued
    // (080); shown only when configured.
    const optout = process.env.SMS_OPTOUT_NUMBER
      ? `\n무료거부 ${process.env.SMS_OPTOUT_NUMBER}`
      : "";
    return `(광고) ${body}${optout}`;
  }
  return body;
}

// ── Transports (all env-gated; return a clear error when not configured) ───────

function isEmailConfigured(): boolean {
  return Boolean(process.env.OUTREACH_SMTP_PASS);
}

let cachedTransport: nodemailer.Transporter | null = null;
function getEmailTransport(): nodemailer.Transporter {
  if (cachedTransport) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: process.env.OUTREACH_SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.OUTREACH_SMTP_PORT || 587),
    secure: Number(process.env.OUTREACH_SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.OUTREACH_SMTP_USER || "",
      pass: process.env.OUTREACH_SMTP_PASS || "",
    },
  });
  return cachedTransport;
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<SendResult> {
  if (!isEmailConfigured()) {
    return { status: "failed", error: "이메일 발송이 설정되지 않았습니다 (OUTREACH_SMTP_PASS)." };
  }
  try {
    const from =
      process.env.OUTREACH_EMAIL_FROM ||
      `${process.env.OUTREACH_SMTP_SENDER_NAME || "AI 마케터"} <${
        process.env.OUTREACH_SMTP_USER || "no-reply@useaimarketer.com"
      }>`;
    await getEmailTransport().sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { status: "sent" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "email send failed",
    };
  }
}

// Solapi (솔라피) covers both SMS/LMS and 카카오 알림톡. Auth: HMAC-SHA256 over
// (date + salt) with the API secret. All values env-gated.
function solapiConfigured(): boolean {
  return Boolean(
    process.env.SOLAPI_API_KEY &&
      process.env.SOLAPI_API_SECRET &&
      process.env.SOLAPI_SENDER_PHONE
  );
}

function solapiAuthHeader(): string {
  const apiKey = process.env.SOLAPI_API_KEY as string;
  const apiSecret = process.env.SOLAPI_API_SECRET as string;
  const date = new Date().toISOString();
  const salt = randomBytes(32).toString("hex");
  const signature = createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function solapiSend(message: Record<string, unknown>): Promise<SendResult> {
  try {
    const res = await fetch("https://api.solapi.com/messages/v4/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: solapiAuthHeader(),
      },
      body: JSON.stringify({ message }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      statusCode?: string;
      statusMessage?: string;
      errorMessage?: string;
    };
    if (!res.ok || (data.statusCode && data.statusCode !== "2000")) {
      return {
        status: "failed",
        error: data.errorMessage || data.statusMessage || `solapi ${res.status}`,
      };
    }
    return { status: "sent" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "sms send failed",
    };
  }
}

export async function sendSms(input: { to: string; text: string }): Promise<SendResult> {
  if (!solapiConfigured()) {
    return {
      status: "failed",
      error: "SMS 발송이 설정되지 않았습니다 (SOLAPI_API_KEY / SECRET / SENDER_PHONE).",
    };
  }
  const to = input.to.replace(/[^0-9]/g, "");
  if (!to) return { status: "failed", error: "전화번호가 없습니다." };
  // >90 bytes auto-promotes to LMS; Solapi picks type by `type` hint.
  const isLong = Buffer.byteLength(input.text, "utf8") > 90;
  return solapiSend({
    to,
    from: (process.env.SOLAPI_SENDER_PHONE as string).replace(/[^0-9]/g, ""),
    text: input.text,
    type: isLong ? "LMS" : "SMS",
  });
}

export async function sendAlimtalk(input: {
  to: string;
  text: string;
}): Promise<SendResult> {
  const pfId = process.env.SOLAPI_ALIMTALK_PFID;
  const templateId = process.env.SOLAPI_ALIMTALK_TEMPLATE_ID;
  if (!solapiConfigured() || !pfId || !templateId) {
    return {
      status: "failed",
      error:
        "알림톡 발송이 설정되지 않았습니다 (SOLAPI_ALIMTALK_PFID / TEMPLATE_ID 및 승인된 템플릿 필요).",
    };
  }
  const to = input.to.replace(/[^0-9]/g, "");
  if (!to) return { status: "failed", error: "전화번호가 없습니다." };
  return solapiSend({
    to,
    from: (process.env.SOLAPI_SENDER_PHONE as string).replace(/[^0-9]/g, ""),
    kakaoOptions: {
      pfId,
      templateId,
      // The approved template's fixed text is used by Kakao; `text` must match
      // the template (variables filled). Provided for SMS fallback.
      disableSms: false,
    },
    text: input.text,
  });
}

export function channelConfigured(channel: OutreachChannel): boolean {
  if (channel === "email") return isEmailConfigured();
  if (channel === "sms") return solapiConfigured();
  return (
    solapiConfigured() &&
    Boolean(process.env.SOLAPI_ALIMTALK_PFID && process.env.SOLAPI_ALIMTALK_TEMPLATE_ID)
  );
}
