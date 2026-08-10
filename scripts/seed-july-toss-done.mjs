// 2026년 7월 마케팅 완료자 29명의 7월 토스를 '완료(done)'로 기록.
//   node scripts/seed-july-toss-done.mjs          # 미리보기(쓰기 없음)
//   node scripts/seed-july-toss-done.mjs --apply  # 실제 upsert
// monthly_toss_status는 (email, month) 유니크라 재실행해도 중복되지 않는다.
// 8월 토스는 건드리지 않는다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MONTH = "2026-07";
const STATUS = "done";
const RECORDED_BY = "ceo.qmeet@gmail.com";

const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

// 7월 마케팅 완료 리스트 (인스타 23 + 유튜브 6 = 29명)
const EMAILS = [
  // 인스타그램
  "cienaseo@naver.com", "hazele.jeong@gmail.com", "tikibird@naver.com",
  "rudalrudal79@naver.com", "kimjimin3312@gmail.com", "frani@kakao.com",
  "dukky1000@gmail.com", "brucejin29@naver.com", "wildrays@naver.com",
  "wlstj5051@naver.com", "chromium0624@naver.com", "dusuga@naver.com",
  "woun7171@hanmail.net", "imhlcoo@gmail.com", "tsujilab@naver.com",
  "tngns0613@naver.com", "forgoodweek@naver.com", "cschoi1688@naver.com",
  "his2715@gmail.com", "annnnnsy@naver.com", "kyb3683@naver.com",
  "bangsc02@gmail.com", "ceo.qmeet@gmail.com",
  // 유튜브
  "nathanae7912@gmail.com", "pyungchang2018@naver.com", "jeannelee.biz@gmail.com",
  "tchaikovsky9440@gmail.com", "be4345@gmail.com", "wfr112@naver.com",
].map((e) => e.trim().toLowerCase());

async function rest(path, init = {}) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const unique = [...new Set(EMAILS)];
if (unique.length !== EMAILS.length) {
  throw new Error(`중단: 리스트에 중복 이메일이 있습니다 (${EMAILS.length} → ${unique.length})`);
}

const now = new Date().toISOString();
const payload = unique.map((email) => ({
  email,
  month: MONTH,
  status: STATUS,
  updated_by: RECORDED_BY,
  updated_at: now,
}));

// 현재 상태 확인
const inList = `(${unique.map((e) => `"${e}"`).join(",")})`;
const current = await rest(
  `monthly_toss_status?email=in.${encodeURIComponent(inList)}&select=email,month,status`
);
const byKey = new Map(current.map((r) => [`${r.email}|${r.month}`, r.status]));

console.log(`대상 ${unique.length}명 · ${MONTH} → ${STATUS}`);
console.log(`  이미 기록된 ${MONTH} 행: ${current.filter((r) => r.month === MONTH).length}건`);
const already = unique.filter((e) => byKey.get(`${e}|${MONTH}`) === STATUS);
if (already.length) console.log(`  이미 '완료'인 사람: ${already.length}명`);

if (!process.argv.includes("--apply")) {
  console.log("\n[미리보기] --apply 없이 실행되어 쓰기는 하지 않았습니다.");
  console.log(unique.map((e, i) => `  ${String(i + 1).padStart(2)}. ${e}  ${byKey.get(`${e}|${MONTH}`) ?? "(없음=대기)"} → ${STATUS}`).join("\n"));
  process.exit(0);
}

await rest("monthly_toss_status?on_conflict=email,month", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify(payload),
});

const after = await rest(
  `monthly_toss_status?email=in.${encodeURIComponent(inList)}&month=eq.${MONTH}&select=email,status`
);
const done = after.filter((r) => r.status === STATUS).length;
console.log(`\n✅ 완료 — ${MONTH} '완료' ${done}/${unique.length}명`);
const missing = unique.filter((e) => !after.some((r) => r.email === e && r.status === STATUS));
if (missing.length) console.log(`⚠️ 반영 안 된 이메일: ${missing.join(", ")}`);

// 8월 토스가 영향받지 않았는지 확인
const aug = await rest(
  `monthly_toss_status?email=in.${encodeURIComponent(inList)}&month=eq.2026-08&select=email,status`
);
console.log(`8월 토스 행: ${aug.length}건 (이번 작업으로 생성/변경되지 않음)`);
