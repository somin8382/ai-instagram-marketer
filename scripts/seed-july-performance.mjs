// 2026년 7월 마케팅 성과(달성 증가분) 1회성 적재 스크립트.
//   node scripts/seed-july-performance.mjs          # 미리보기(쓰기 없음)
//   node scripts/seed-july-performance.mjs --apply  # 실제 upsert
//
// monthly_performance는 email+month 유니크라서 재실행해도 중복되지 않고 갱신된다.
// user_id는 profiles에서 이메일로 조회해 함께 채운다(마이페이지 RLS가 user_id
// 우선 매칭이므로).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MONTH = "2026-07";
const RECORDED_BY = "ceo.qmeet@gmail.com";

const env = {};
for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) throw new Error(".env.local에 SUPABASE URL/SERVICE_ROLE_KEY가 필요합니다.");

// [이름, 이메일, 채널주소, 팔로워/구독자, 게시물주소, 좋아요/조회수, 댓글, 비고]
const INSTAGRAM = [
  ["서호연", "cienaseo@naver.com", "https://www.instagram.com/seoho_ikebana", 537, "https://www.instagram.com/reel/DajU4cqPGjS/", 109, 30],
  ["정하연", "hazele.jeong@gmail.com", "https://www.instagram.com/pintar.global", 524, "https://www.instagram.com/p/DauyedbSiio/", 102, 30],
  ["김준호", "tikibird@naver.com", "https://www.instagram.com/dapulo_official", 505, "https://www.instagram.com/p/DaHY78vD28O/?img_index=1", 102, 30],
  ["박경미", "rudalrudal79@naver.com", "https://www.instagram.com/eunhasumom_", 536, "https://www.instagram.com/p/DXp7Z9oEqZD/", 109, 30],
  ["김지민", "kimjimin3312@gmail.com", "https://www.instagram.com/mnjmn365", 531, "https://www.instagram.com/reel/DaM-ommSIe_/?igsh=MWN6NngycGZlbG1sdA==", 105, 30],
  ["황하정", "frani@kakao.com", "https://www.instagram.com/matapet.official", 541, "https://www.instagram.com/reel/DSKuyCbD8Ww/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==", 109, 30],
  ["천다올", "dukky1000@gmail.com", "https://www.instagram.com/pic.ke_official", 535, "https://www.instagram.com/p/DaK7ZaVlJpE/?igsh=N3AyaDFxbGFoN3dh", 100, 30],
  ["이진희", "brucejin29@naver.com", "https://www.instagram.com/gangwonjikgoo/", 518, "https://www.instagram.com/p/DaW2MfED5DB/?igsh=MWI0aXl6cGd6bXhlNQ==", 100, 30],
  ["김수황", "wildrays@naver.com", "https://www.instagram.com/lawblog.official", 527, "https://www.instagram.com/p/Da2GQdPE82N/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==", 103, 30],
  ["장진서", "wlstj5051@naver.com", "https://www.instagram.com/amoring_korea", 548, "https://www.instagram.com/reel/Da2UsxYHK5F/", 101, 30],
  ["이하은", "chromium0624@naver.com", "https://www.instagram.com/project_chojune", 538, "https://www.instagram.com/p/Dajm5KiTF30/?igsh=cjY1c2dzeW82Ym1r", 105, 30],
  ["장두석", "dusuga@naver.com", "https://www.instagram.com/novendia_official", 528, "https://www.instagram.com/reels/DamE3JRg8Wx/", 106, 30],
  ["원준", "woun7171@hanmail.net", "https://www.instagram.com/puremove_official", 507, "https://www.instagram.com/p/DVkT1wqEXPm/?igsh=dXB0ZzViOGEzODBj", 109, 30],
  ["임해수", "imhlcoo@gmail.com", "https://www.instagram.com/oowa.kr", 526, "https://www.instagram.com/p/DaP2KHnGpsg/?img_index=1", 101, 30],
  ["츠지 나츠미", "tsujilab@naver.com", "https://www.instagram.com/natsumi0045", 511, "https://www.instagram.com/p/DacfbAzkwCB/?utm_source=ig_web_button_share_sheet&igsh=MzRlODBiNWFlZA==", 106, 30],
  ["조수훈", "tngns0613@naver.com", "https://www.instagram.com/on.do_tome.official/", 548, "https://www.instagram.com/p/DaiZJLEE4bf/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==", 102, 30],
  ["양선주", "forgoodweek@naver.com", "https://www.instagram.com/forgoodweek", 505, "https://www.instagram.com/reel/DaTTOn5zx6d/?igsh=cTk3eWs5cWtoZng0", 110, 30],
  ["최초석", "cschoi1688@naver.com", "https://www.instagram.com/haru_diy_kr", 528, "https://www.instagram.com/p/DYTFlz5E635/?img_index=1", 110, 30],
  ["황인성", "his2715@gmail.com", "https://www.instagram.com/slowok_turtle", 504, "https://www.instagram.com/p/DaMrZi7ElfI/?img_index=1", 105, 30],
  ["안세영", "annnnnsy@naver.com", "https://www.instagram.com/sayhan_day", 504, "https://www.instagram.com/reel/DYyLIZHJR4p/", 101, 30],
  ["김유빈", "kyb3683@naver.com", "https://www.instagram.com/bloom_.log", 504, "https://www.instagram.com/p/DYomQWyEkaG/?igsh=YjE5cWticTE1aDFu", 108, 30],
  ["방성철", "bangsc02@gmail.com", "https://www.instagram.com/safeharuday/", 526, "https://www.instagram.com/p/DaxGyIXkozC/?igsh=N3NtNzVsb3NiOHB5", 101, 30],
  // 내부 관리자 계정. 2차 리스트에서 채널·게시물이 방성철 행과 분리되어 포함함.
  ["관리자", "ceo.qmeet@gmail.com", "https://www.instagram.com/qmeet.official", 526, "https://www.instagram.com/p/DRZJPXtEw7r/", 101, 30],
];

const YOUTUBE = [
  ["김재영", "nathanae7912@gmail.com", "https://www.youtube.com/@대리운전탁송_나엘로", 214, "https://youtu.be/bOQiFvmp9zA", 1027, 10],
  ["김예나", "pyungchang2018@naver.com", "https://www.youtube.com/@kbeautyinsight", 213, "https://youtu.be/cYtjj67TjZE", 1045, 10],
  ["이지윤", "jeannelee.biz@gmail.com", "https://www.youtube.com/@biolog-xyz", 205, "https://www.youtube.com/shorts/rFC-jYHZeyE", 1026, 10],
  ["김근희", "tchaikovsky9440@gmail.com", "https://www.youtube.com/@TchaikopJenny", 213, "https://www.youtube.com/shorts/Uu2ScnhCSFY", 1088, 10],
  ["강민경", "be4345@gmail.com", "https://youtube.com/channel/UCXBgeUJSntyN7Q-6nWN7i9g?si=CLQNSc1fGO1mwVzm", 205, "https://youtu.be/CZiPixoT3oA?si=h8ecgiaFv4OoD9lR", 1009, 10],
  ["박정훈", "wfr112@naver.com", "https://www.youtube.com/@AquapalAIUS", 538, "https://www.youtube.com/shorts/qKTMHZ6ydEE", 1056, 0, "채널 특성상 댓글 대신 구독자 수로 대체 달성"],
];

const rows = [
  ...INSTAGRAM.map(([name, email, channel, followers, post, likes, comments, note]) => ({
    name,
    email: email.toLowerCase(),
    month: MONTH,
    platform: "instagram",
    channel_url: channel,
    post_url: post,
    followers_gained: followers,
    likes_gained: likes,
    views_gained: null,
    comments_gained: comments,
    note: note ?? null,
    recorded_by: RECORDED_BY,
  })),
  ...YOUTUBE.map(([name, email, channel, subs, post, views, comments, note]) => ({
    name,
    email: email.toLowerCase(),
    month: MONTH,
    platform: "youtube",
    channel_url: channel,
    post_url: post,
    followers_gained: subs,
    likes_gained: null,
    views_gained: views,
    comments_gained: comments,
    note: note ?? null,
    recorded_by: RECORDED_BY,
  })),
];

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

// 이메일 → user_id 매핑 (없으면 null로 두고 이메일 기준 RLS로 조회된다)
const emails = rows.map((r) => r.email);
const inList = `(${emails.map((e) => `"${e}"`).join(",")})`;
const profiles = await rest(
  `profiles?email=in.${encodeURIComponent(inList)}&select=id,email`
);
const userIdByEmail = new Map(
  profiles.map((p) => [(p.email || "").toLowerCase(), p.id])
);

const payload = rows.map(({ name, ...rest }) => ({
  ...rest,
  user_id: userIdByEmail.get(rest.email) ?? null,
  updated_at: new Date().toISOString(),
}));

const missing = rows.filter((r) => !userIdByEmail.has(r.email));
console.log(`총 ${payload.length}건 (인스타 ${INSTAGRAM.length} / 유튜브 ${YOUTUBE.length})`);
if (missing.length) {
  console.log(
    `※ profiles 미가입(=user_id null, 이메일로 매칭): ${missing.map((m) => `${m.name}<${m.email}>`).join(", ")}`
  );
}

if (!process.argv.includes("--apply")) {
  console.log("\n[미리보기] --apply 없이 실행되어 쓰기는 하지 않았습니다.\n");
  console.log(JSON.stringify(payload.slice(0, 3), null, 2));
  process.exit(0);
}

await rest("monthly_performance?on_conflict=email,month", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify(payload),
});
console.log("✅ upsert 완료");
