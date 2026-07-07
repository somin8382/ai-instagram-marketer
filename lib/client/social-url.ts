// Pure string-based Instagram/YouTube URL validation and normalization.
// No network access: this only reduces typos before submission; the user
// still verifies the link opens correctly via the review step.

export type SocialUrlStatus = "ok" | "invalid" | "check";
export type SocialUrlKind = "account" | "post" | "unknown";

export type SocialUrlCheck = {
  status: SocialUrlStatus;
  /** 형식 정상 / 형식 오류 / 확인 필요 */
  statusLabel: string;
  kind: SocialUrlKind;
  kindLabel: string;
  normalized: string;
  message: string;
};

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

function tryParse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function result(
  status: SocialUrlStatus,
  kind: SocialUrlKind,
  normalized: string,
  message: string
): SocialUrlCheck {
  return {
    status,
    statusLabel:
      status === "ok" ? "형식 정상" : status === "invalid" ? "형식 오류" : "확인 필요",
    kind,
    kindLabel:
      kind === "account" ? "계정 링크" : kind === "post" ? "게시물 링크" : "",
    normalized,
    message,
  };
}

export function checkSocialUrl(
  rawInput: string,
  platform: "instagram" | "youtube"
): SocialUrlCheck | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null; // optional field left empty

  if (/\s/.test(trimmed)) {
    return result("invalid", "unknown", trimmed, "URL에 공백이 있습니다.");
  }

  // Add https:// when the scheme is missing (common paste mistake)
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = tryParse(withScheme);
  if (!parsed) {
    return result("invalid", "unknown", trimmed, "URL 형식이 올바르지 않습니다.");
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, "");

  if (platform === "instagram") {
    if (!INSTAGRAM_HOSTS.has(host)) {
      return result(
        "check",
        "unknown",
        withScheme,
        "인스타그램 주소(instagram.com)가 아닌 것 같습니다. 직접 확인해주세요."
      );
    }
    const normalized = `https://www.instagram.com${path}`;
    if (/^\/(p|reel|reels|tv)\//.test(path)) {
      return result(
        "ok",
        "post",
        normalized,
        "게시물 링크입니다. 계정(프로필) 링크가 맞는지 확인해주세요."
      );
    }
    if (/^\/[A-Za-z0-9._]{1,30}$/.test(path)) {
      return result("ok", "account", normalized, "계정 링크로 보입니다.");
    }
    if (path === "" || path === "/") {
      return result(
        "check",
        "unknown",
        normalized,
        "계정명이 없는 인스타그램 주소입니다. 프로필 링크를 입력해주세요."
      );
    }
    return result(
      "check",
      "unknown",
      normalized,
      "일반적인 계정 링크 형식이 아닙니다. 직접 열어 확인해주세요."
    );
  }

  // youtube
  if (!YOUTUBE_HOSTS.has(host)) {
    return result(
      "check",
      "unknown",
      withScheme,
      "유튜브 주소(youtube.com)가 아닌 것 같습니다. 직접 확인해주세요."
    );
  }
  if (host === "youtu.be" || /^\/(watch|shorts|embed)/.test(path)) {
    const normalized =
      host === "youtu.be"
        ? `https://youtu.be${path}`
        : `https://www.youtube.com${path}${parsed.search}`;
    return result(
      "ok",
      "post",
      normalized,
      "영상 링크입니다. 채널 링크가 맞는지 확인해주세요."
    );
  }
  const normalized = `https://www.youtube.com${path}`;
  if (/^\/@[\w.-]{1,50}$/.test(path) || /^\/(channel|c|user)\/[\w-]+$/.test(path)) {
    return result("ok", "account", normalized, "채널 링크로 보입니다.");
  }
  if (path === "" || path === "/") {
    return result(
      "check",
      "unknown",
      normalized,
      "채널명이 없는 유튜브 주소입니다. 채널 링크를 입력해주세요."
    );
  }
  return result(
    "check",
    "unknown",
    normalized,
    "일반적인 채널 링크 형식이 아닙니다. 직접 열어 확인해주세요."
  );
}
