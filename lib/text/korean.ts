export function stripTrailingPunct(s: string): string {
  return (s ?? "").trim().replace(/[.,!?…·、。\s]+$/u, "");
}

export function hasBatchim(word: string): boolean {
  const w = (word ?? "").trim();
  if (!w) return false;
  const c = w.charCodeAt(w.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 !== 0;
}

export function josa(word: string, withB: string, withoutB: string): string {
  return `${word}${hasBatchim(word) ? withB : withoutB}`;
}

// CJK 호환 기호 블록(㈀-㏿) 및 제어문자 제거, 중복 공백 정리
const CJK_COMPAT_SYMBOLS = /[㈀-㏿]/gu;
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
const MULTI_SPACE = /[ \t]{2,}/g;

export function sanitizeGenerated(s: string): string {
  return (s ?? "")
    .replace(CJK_COMPAT_SYMBOLS, "")
    .replace(CONTROL_CHARS, "")
    .replace(MULTI_SPACE, " ")
    .trim();
}
