import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr/ArrowUpRight";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { MotionRoot } from "@/lib/ui/motion/motion-root";
import { PromptConsole } from "./_components/prompt-console";
import { Reveal, ScrubbedSentence, WordReveal } from "@/lib/ui/motion/reveal";
import { StickyStack, type StackScene } from "@/lib/ui/motion/sticky-stack";
import "@/lib/ui/motion/motion.css";

export const metadata = {
  title: "랜딩페이지 개발 AI",
  description:
    "가게 이야기를 한 문장으로 적으면 인스타 프로필에 걸 수 있는 페이지 한 장이 만들어집니다.",
};

const SCENES: StackScene[] = [
  {
    verb: "적는다",
    title: "두세 문장이면 충분합니다",
    body: "무엇을 파는 가게인지, 무엇을 가장 먼저 보여주고 싶은지만 적으세요. 이미 등록해 두신 브랜드 정보가 있으면 그대로 가져옵니다.",
  },
  {
    verb: "만들어진다",
    title: "구성과 문구를 한 번에 잡습니다",
    body: "첫 화면부터 메뉴, 오시는 길, 문의 버튼까지 순서대로 배치합니다. 마음에 걸리는 부분은 그 자리만 골라 다시 만들 수 있습니다.",
  },
  {
    verb: "붙인다",
    title: "주소 하나가 남습니다",
    body: "완성된 페이지는 바로 발행됩니다. 인스타그램 프로필의 링크 칸에 그 주소를 넣으면 끝입니다.",
  },
];

const INCLUDED = [
  "한 장으로 끝나는 원페이지 구성",
  "모바일과 PC 자동 대응",
  "인스타 프로필에 넣을 공개 주소",
  "섹션별 문구와 이미지 재생성",
];

const NOT_INCLUDED = ["결제와 장바구니", "회원가입과 로그인", "예약 시스템 연동"];

const KAKAO_URL = "https://open.kakao.com/o/s0Viuxzi";

export default function LandingAiPage() {
  return (
    <div
      className="ink-surface ink-grain font-sans"
      style={{ "--ink-accent": "#3d6dff" } as React.CSSProperties}
    >
      <MotionRoot>
        {/* Navigation */}
        <header
          className="sticky top-0 z-30 border-b backdrop-blur-md"
          style={{
            borderColor: "var(--ink-line)",
            background: "rgba(10, 11, 15, 0.72)",
          }}
        >
          <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              랜딩페이지 개발 AI
            </Link>
            <div className="flex items-center gap-6">
              <Link
                href="/"
                className="text-sm transition-colors hover:text-[color:var(--ink-text)]"
                style={{ color: "var(--ink-muted)" }}
              >
                홈
              </Link>
              <a
                href="#prompt"
                className="rounded-full px-4 py-2 text-sm font-semibold text-white transition-transform duration-300 hover:-translate-y-0.5"
                style={{ background: "var(--ink-accent)" }}
              >
                만들어보기
              </a>
            </div>
          </nav>
        </header>

        <main>
          {/* Hero */}
          <section className="relative overflow-hidden">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(72rem 40rem at 22% 26%, rgba(61,109,255,0.15), transparent 68%)",
              }}
            />
            <div className="relative mx-auto flex min-h-[calc(100dvh-4rem)] max-w-6xl flex-col justify-center px-5 pt-20 pb-24 sm:px-8 sm:pt-24">
              <div className="max-w-4xl">
              <p
                className="text-xs font-semibold tracking-[0.08em]"
                style={{ color: "var(--ink-accent)" }}
              >
                랜딩페이지 개발 AI
              </p>

              <WordReveal
                as="h1"
                lines={["한 문장을 적으면", "페이지가 됩니다"]}
                accentWords={["페이지가"]}
                className="mt-6 text-[3rem] font-semibold leading-[1.08] tracking-tighter sm:text-7xl md:text-8xl"
                delay={0.15}
              />

              <Reveal className="mt-8 max-w-xl">
                <p
                  className="text-lg leading-relaxed sm:text-xl"
                  style={{ color: "var(--ink-muted)" }}
                >
                  가게 이야기를 적으면 구성과 문구, 이미지 배치까지 잡아
                  드립니다. 인스타 프로필에 걸 주소는 그 자리에서 나옵니다.
                </p>
              </Reveal>

              <Reveal className="mt-10 flex flex-wrap items-center gap-3">
                <a
                  data-reveal-item
                  href="#prompt"
                  className="group inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold text-white transition-transform duration-300 hover:-translate-y-0.5"
                  style={{ background: "var(--ink-accent)" }}
                >
                  만들어보기
                  <ArrowUpRight
                    size={16}
                    weight="bold"
                    className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  />
                </a>
                <a
                  data-reveal-item
                  href={KAKAO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border px-6 py-3.5 text-sm font-semibold transition-colors duration-300 hover:border-[color:var(--ink-accent)]"
                  style={{ borderColor: "var(--ink-line-strong)" }}
                >
                  사전 신청
                </a>
              </Reveal>
              </div>
            </div>
          </section>

          {/* Why this exists. Scroll paces the sentence one beat at a time. */}
          <section className="mx-auto max-w-4xl px-5 py-28 sm:px-8 sm:py-36">
            <ScrubbedSentence
              text="인스타그램 프로필에는 링크를 넣는 칸이 하나 있습니다. 대부분의 가게는 넣을 페이지가 없어서 그 칸을 비워둡니다."
              className="text-2xl font-medium leading-[1.6] tracking-tight sm:text-4xl sm:leading-[1.5]"
            />
          </section>

          {/* Build story */}
          <section className="mx-auto max-w-6xl px-5 pb-16 sm:px-8">
            <WordReveal
              as="h2"
              lines={["적고, 받고, 붙입니다"]}
              className="text-4xl font-semibold tracking-tighter sm:text-6xl"
            />
          </section>
          <StickyStack scenes={SCENES} />

          {/* Scope */}
          <section className="mx-auto max-w-6xl px-5 py-28 sm:px-8 sm:py-36">
            <div className="grid grid-cols-1 gap-14 md:grid-cols-12 md:gap-10">
              <div className="md:col-span-5">
                <WordReveal
                  as="h2"
                  lines={["한 장짜리", "페이지입니다"]}
                  className="text-4xl font-semibold leading-[1.1] tracking-tighter sm:text-5xl"
                />
                <Reveal className="mt-6">
                  <p
                    className="text-base leading-relaxed sm:text-lg"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    쇼핑몰이나 예약 시스템이 필요하시면 이 도구로는 안 됩니다.
                    그건 먼저 말씀드리는 게 맞다고 봅니다.
                  </p>
                </Reveal>
              </div>

              <Reveal className="md:col-span-6 md:col-start-7">
                <ul className="space-y-4">
                  {INCLUDED.map((item) => (
                    <li
                      key={item}
                      data-reveal-item
                      className="flex items-start gap-3 text-lg sm:text-xl"
                    >
                      <Check
                        size={20}
                        weight="bold"
                        className="mt-1 shrink-0"
                        style={{ color: "var(--ink-accent)" }}
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                <div
                  className="mt-10 border-t pt-8"
                  style={{ borderColor: "var(--ink-line)" }}
                >
                  <p
                    className="text-sm font-medium"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    아직 지원하지 않습니다
                  </p>
                  <p
                    className="mt-3 text-base leading-relaxed"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    {NOT_INCLUDED.join(", ")}
                  </p>
                </div>
              </Reveal>
            </div>
          </section>

          {/* Prompt */}
          <section
            id="prompt"
            className="mx-auto max-w-3xl scroll-mt-16 px-5 py-28 sm:px-8 sm:py-36"
          >
            <WordReveal
              as="h2"
              lines={["지금 적어보세요"]}
              className="text-4xl font-semibold tracking-tighter sm:text-6xl"
            />
            <Reveal className="mt-12">
              <PromptConsole />
            </Reveal>
          </section>

          {/* Closing */}
          <section className="mx-auto max-w-6xl px-5 pb-28 sm:px-8 sm:pb-36">
            <Reveal>
              <div
                className="rounded-3xl border px-7 py-14 text-center sm:px-12 sm:py-20"
                style={{
                  borderColor: "var(--ink-line-strong)",
                  background: "var(--ink-raised)",
                }}
              >
                <h2 className="text-3xl font-semibold tracking-tighter sm:text-5xl">
                  정식 오픈 전에 먼저 써보시겠어요?
                </h2>
                <p
                  className="mx-auto mt-5 max-w-md text-base leading-relaxed sm:text-lg"
                  style={{ color: "var(--ink-muted)" }}
                >
                  사전 신청해 두시면 열리는 대로 연락드립니다.
                </p>
                <a
                  href={KAKAO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="group mt-9 inline-flex items-center gap-2 rounded-full px-7 py-4 text-sm font-semibold text-white transition-transform duration-300 hover:-translate-y-0.5"
                  style={{ background: "var(--ink-accent)" }}
                >
                  카카오톡으로 사전 신청
                  <ArrowUpRight
                    size={16}
                    weight="bold"
                    className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  />
                </a>
              </div>
            </Reveal>
          </section>
        </main>

        <footer className="border-t" style={{ borderColor: "var(--ink-line)" }}>
          <div
            className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm sm:px-8"
            style={{ color: "var(--ink-muted)" }}
          >
            <span>큐밋</span>
            <div className="flex items-center gap-6">
              <Link href="/" className="hover:text-[color:var(--ink-text)]">
                홈
              </Link>
              <Link href="/pricing" className="hover:text-[color:var(--ink-text)]">
                가격 안내
              </Link>
              <Link href="/mypage" className="hover:text-[color:var(--ink-text)]">
                마이페이지
              </Link>
            </div>
          </div>
        </footer>
      </MotionRoot>
    </div>
  );
}
