"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment } from "react";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { MotionRoot } from "@/lib/ui/motion/motion-root";
import { HorizontalPan } from "@/lib/ui/motion/horizontal-pan";
import { Reveal, ScrubbedSentence, WordReveal } from "@/lib/ui/motion/reveal";
import { CountUp } from "@/lib/ui/motion/count-up";
import { GrowthCurve } from "@/lib/ui/motion/growth-curve";
import { BarCompare, type CompareRow } from "@/lib/ui/motion/bar-compare";
import { REVIEWS, quoteLength } from "@/lib/ui/reviews";
import "@/lib/ui/motion/motion.css";

const ACCENT = "#ef4a6b";

/** 마케터 1명 1개월 가격. 히어로·제품 목록·비용 비교가 같은 값을 쓴다. */
const MARKETER_MONTHLY_PRICE = 330_000;
const HIRE_MONTHLY_COST = 3_000_000;

/** A row of 실제 고객이 경험한 변화. Rows carry a counted value, a chart, or
 *  both; `beforeLabel` marks the ones that are a 이전 → 이후 comparison. */
type Stat = {
  label: string;
  from?: number;
  to?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  beforeLabel?: string;
  note?: string;
  footnote?: boolean;
  curve?: { startLabel: string; endLabel: string };
  bars?: CompareRow[];
};

const COST_ROWS: CompareRow[] = [
  {
    label: "마케터 직접 채용",
    value: HIRE_MONTHLY_COST,
    valueLabel: `₩${HIRE_MONTHLY_COST.toLocaleString("ko-KR")}`,
  },
  {
    label: "AI 마케터",
    value: MARKETER_MONTHLY_PRICE,
    valueLabel: `₩${MARKETER_MONTHLY_PRICE.toLocaleString("ko-KR")}`,
    highlight: true,
  },
];

/** 신청 플로우가 실제로 안내하는 범위에 맞춘 핵심 기능. */
const CAPABILITIES = [
  {
    title: "계정 기획",
    body: "브랜드에 맞는 계정 방향과 소개글, 운영 컨셉을 먼저 정리합니다.",
  },
  {
    title: "계정명 추천",
    body: "계정이 없다면 이름 후보부터 제안하고, 만든 뒤 그대로 이어서 운영합니다.",
  },
  {
    title: "콘텐츠 기획",
    body: "무엇을 언제 올릴지 월 1~2회 업로드 기준으로 기획해 드립니다.",
  },
  {
    title: "노출과 반응 운영",
    body: "팔로워와 좋아요, 댓글이 실제로 쌓이도록 목표를 두고 운영합니다.",
  },
];

/**
 * Renders `**...**` spans as bold in the same typeface. Mixed-family emphasis
 * reads as amateur; weight is the honest way to point at a sentence.
 */
function renderQuote(quote: string) {
  return quote
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, index) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong
          key={index}
          className="font-semibold"
          style={{ color: "var(--ink-text)" }}
        >
          {part.slice(2, -2)}
        </strong>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      )
    );
}

/**
 * The signed-out front door. Rendered both at `/` (inside the application flow,
 * where `onApply` enters the 신청 state machine) and at `/preview/home`, so a
 * signed-in owner can still see what visitors see.
 */
export function HomeLanding({
  onApply,
  isPreview = false,
}: {
  onApply: () => void;
  isPreview?: boolean;
}) {
  const router = useRouter();
  const products = [
    {
      name: "AI 마케터",
      summary: "계정 기획부터, 마케팅까지 AI에이전트에게 맡깁니다.",
      price: "월 33만원부터",
      onClick: onApply,
    },
    {
      name: "게시물 AI 생성기",
      summary: "프롬프트를 넣으면 게시물 문구와 이미지가 함께 나옵니다.",
      price: "월 2만 2천원",
      href: "/tools",
    },
  ];

  // 실제 고객이 경험한 변화. 스크롤이 닿으면 뒤 숫자가 앞 숫자에서부터 오른다.
  // beforeLabel 이 없는 항목은 "이전 → 이후"가 아니라 값 하나를 세는 지표다.
  const stats: Stat[] = [
    {
      label: "팔로우 달성 사례",
      from: 13,
      to: 529,
      suffix: "명",
      beforeLabel: "13명",
      curve: { startLabel: "13명", endLabel: "529명" },
    },
    {
      label: "고객 만족도",
      from: 0,
      to: 9.4,
      suffix: "/10",
      decimals: 1,
      note: "평균",
    },
    {
      label: "비용 비교",
      footnote: true,
      bars: COST_ROWS,
    },
  ];

  return (
    <div
      className="ink-surface ink-grain font-sans"
      style={{ "--ink-accent": ACCENT } as React.CSSProperties}
    >
      <MotionRoot>
        <header
          className="sticky top-0 z-30 border-b backdrop-blur-md"
          style={{
            borderColor: "var(--ink-line)",
            background: "rgba(10, 11, 15, 0.72)",
          }}
        >
          <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold tracking-tight">큐밋</span>
              {isPreview ? (
                <span
                  className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                  style={{
                    borderColor: "var(--ink-line-strong)",
                    color: "var(--ink-muted)",
                  }}
                >
                  미리보기
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-6">
              {isPreview ? (
                // 이미 로그인한 상태로 들어오는 화면이라 "로그인" 버튼을
                // 보여주면 로그아웃된 것처럼 보인다. 대신 돌아갈 길을 준다.
                <button
                  type="button"
                  onClick={() => router.push("/mypage")}
                  className="text-sm transition-colors hover:text-[color:var(--ink-text)]"
                  style={{ color: "var(--ink-muted)" }}
                >
                  마이페이지로 돌아가기
                </button>
              ) : (
                <Link
                  href="/auth"
                  className="text-sm transition-colors hover:text-[color:var(--ink-text)]"
                  style={{ color: "var(--ink-muted)" }}
                >
                  로그인
                </Link>
              )}
              <button
                type="button"
                onClick={onApply}
                className="rounded-full px-4 py-2 text-sm font-semibold text-white transition-transform duration-300 hover:-translate-y-0.5"
                style={{ background: "var(--ink-accent)" }}
              >
                시작하기
              </button>
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
                  "radial-gradient(72rem 40rem at 24% 24%, rgba(239,74,107,0.16), transparent 68%)",
              }}
            />
            <div className="relative mx-auto flex min-h-[calc(100dvh-4rem)] max-w-6xl flex-col justify-center px-5 pt-20 pb-24 sm:px-8 sm:pt-24">
              <div className="max-w-4xl">
                <p
                  className="text-xs font-semibold tracking-[0.08em]"
                  style={{ color: "var(--ink-accent)" }}
                >
                  AI 마케팅 서비스
                </p>

                <WordReveal
                  as="h1"
                  lines={["AI 마케터를 월 33만원에", "고용하세요"]}
                  accentWords={["33만원에"]}
                  className="mt-6 text-[2.75rem] font-semibold leading-[1.1] tracking-tighter sm:text-6xl md:text-7xl"
                  delay={0.15}
                />

                <Reveal className="mt-8 max-w-xl">
                  <p
                    className="text-lg leading-relaxed sm:text-xl"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    일반 마케터 대비 최대 90% 비용 절감. 전문 마케터 수준의
                    결과를 더 빠르고 합리적인 비용으로 만들어 드립니다.
                  </p>
                </Reveal>

                <Reveal className="mt-10 flex flex-wrap items-center gap-3">
                  <button
                    data-reveal-item
                    type="button"
                    onClick={onApply}
                    className="group inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold text-white transition-transform duration-300 hover:-translate-y-0.5"
                    style={{ background: "var(--ink-accent)" }}
                  >
                    시작하기
                    <ArrowUpRight
                      size={16}
                      weight="bold"
                      className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    />
                  </button>
                  <a
                    data-reveal-item
                    href="#reviews"
                    className="inline-flex items-center gap-2 rounded-full border px-6 py-3.5 text-sm font-semibold transition-colors duration-300 hover:border-[color:var(--ink-accent)]"
                    style={{ borderColor: "var(--ink-line-strong)" }}
                  >
                    고객 후기 보기
                  </a>
                </Reveal>
              </div>
            </div>
          </section>

          {/* Problem. Scroll paces the sentence one beat at a time. */}
          <section className="mx-auto max-w-4xl px-5 py-28 sm:px-8 sm:py-36">
            <ScrubbedSentence
              text="마케터를 직접 채용하기에는 비용도, 관리도 부담됩니다."
              className="text-2xl font-medium leading-[1.6] tracking-tight sm:text-4xl sm:leading-[1.5]"
            />
          </section>

          {/* Proof. The numbers carry this section, so each one counts up from
              its "before" value the moment it lands in view. */}
          <section className="mx-auto max-w-6xl px-5 pb-28 sm:px-8 sm:pb-36">
            <WordReveal
              as="h2"
              lines={["실제 고객이", "경험한 변화"]}
              accentWords={["변화"]}
              className="text-4xl font-semibold leading-[1.1] tracking-tighter sm:text-6xl"
            />

            <Reveal className="mt-14">
              <div
                className="border-t"
                style={{ borderColor: "var(--ink-line)" }}
              >
                {stats.map((stat) => (
                  <div
                    key={stat.label}
                    data-reveal-item
                    className="grid grid-cols-1 gap-4 border-b py-9 md:grid-cols-12 md:items-center md:gap-6 md:py-11"
                    style={{ borderColor: "var(--ink-line)" }}
                  >
                    <p
                      className="text-sm font-medium md:col-span-4 sm:text-base"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      {stat.label}
                      {stat.footnote ? (
                        <span style={{ color: "var(--ink-accent)" }}>*</span>
                      ) : null}
                    </p>

                    <div className="space-y-6 md:col-span-8">
                      <div
                        className={`flex-wrap items-baseline gap-3 sm:gap-4 ${
                          stat.to === undefined ? "hidden" : "flex"
                        }`}
                      >
                        {stat.beforeLabel ? (
                          <>
                            <span
                              className="font-mono text-2xl tabular-nums sm:text-3xl"
                              style={{ color: "var(--ink-muted)" }}
                            >
                              {stat.beforeLabel}
                            </span>
                            <ArrowRight
                              size={20}
                              weight="bold"
                              className="shrink-0 translate-y-[-0.15em]"
                              style={{ color: "var(--ink-accent)" }}
                            />
                          </>
                        ) : null}
                        {stat.note ? (
                          <span
                            className="text-sm font-medium"
                            style={{ color: "var(--ink-muted)" }}
                          >
                            {stat.note}
                          </span>
                        ) : null}
                        {stat.to === undefined ? null : (
                          <CountUp
                            from={stat.from ?? 0}
                            to={stat.to}
                            prefix={stat.prefix}
                            suffix={stat.suffix}
                            decimals={stat.decimals}
                            className="font-mono text-4xl font-semibold tracking-tight sm:text-6xl"
                          />
                        )}
                      </div>

                      {stat.curve ? (
                        <GrowthCurve
                          startLabel={stat.curve.startLabel}
                          endLabel={stat.curve.endLabel}
                        />
                      ) : null}

                      {stat.bars ? <BarCompare rows={stat.bars} /> : null}
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>

            <Reveal className="mt-6">
              <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                * 마케터 1인을 직접 채용했을 때의 월 급여와 AI 마케터 1명 월
                이용료를 비교한 금액입니다.
              </p>
            </Reveal>
          </section>

          {/* What the 마케터 actually does. */}
          <section className="mx-auto max-w-6xl px-5 pb-28 sm:px-8 sm:pb-36">
            <div className="grid grid-cols-1 gap-14 md:grid-cols-12 md:gap-10">
              <div className="md:col-span-5">
                <WordReveal
                  as="h2"
                  lines={["맡기면", "이렇게 합니다"]}
                  className="text-4xl font-semibold leading-[1.1] tracking-tighter sm:text-5xl"
                />
                <Reveal className="mt-6">
                  <p
                    className="text-base leading-relaxed sm:text-lg"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    계정이 아직 없어도 괜찮습니다. 이름을 정하는 일부터
                    같이 시작합니다.
                  </p>
                </Reveal>
              </div>

              <Reveal className="md:col-span-6 md:col-start-7">
                <div
                  className="border-t"
                  style={{ borderColor: "var(--ink-line)" }}
                >
                  {CAPABILITIES.map((item, index) => (
                    <div
                      key={item.title}
                      data-reveal-item
                      className="flex gap-5 border-b py-7"
                      style={{ borderColor: "var(--ink-line)" }}
                    >
                      <span
                        className="font-mono text-sm tabular-nums"
                        style={{ color: "var(--ink-accent)" }}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="space-y-2">
                        <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">
                          {item.title}
                        </h3>
                        <p
                          className="text-sm leading-relaxed sm:text-base"
                          style={{ color: "var(--ink-muted)" }}
                        >
                          {item.body}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </Reveal>
            </div>
          </section>

          {/* Products */}
          <section className="mx-auto max-w-6xl px-5 pb-28 sm:px-8 sm:pb-36">
            <WordReveal
              as="h2"
              lines={["두 가지로", "나눠 두었습니다"]}
              className="text-4xl font-semibold leading-[1.1] tracking-tighter sm:text-6xl"
            />

            <Reveal className="mt-14">
              <div
                className="border-t"
                style={{ borderColor: "var(--ink-line)" }}
              >
                {products.map((product) => {
                  const rowClass =
                    "group grid w-full grid-cols-1 gap-3 border-b py-8 text-left transition-colors duration-300 md:grid-cols-12 md:items-baseline md:gap-6 md:py-10";
                  const rowStyle = { borderColor: "var(--ink-line)" };
                  const inner = (
                    <>
                      <h3 className="text-3xl font-semibold tracking-tight transition-colors duration-300 group-hover:text-[color:var(--ink-accent)] md:col-span-4 sm:text-4xl">
                        {product.name}
                      </h3>
                      <p
                        className="text-base leading-relaxed md:col-span-5 sm:text-lg"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        {product.summary}
                      </p>
                      <p className="font-mono text-sm md:col-span-2 md:text-right">
                        {product.price}
                      </p>
                      <span className="md:col-span-1 md:justify-self-end">
                        <ArrowRight
                          size={20}
                          weight="bold"
                          className="transition-transform duration-300 group-hover:translate-x-1"
                          style={{ color: "var(--ink-accent)" }}
                        />
                      </span>
                    </>
                  );

                  return product.href ? (
                    <Link
                      key={product.name}
                      data-reveal-item
                      href={product.href}
                      className={rowClass}
                      style={rowStyle}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <button
                      key={product.name}
                      data-reveal-item
                      type="button"
                      onClick={product.onClick}
                      className={rowClass}
                      style={rowStyle}
                    >
                      {inner}
                    </button>
                  );
                })}
              </div>
            </Reveal>
          </section>

          {/* Reviews */}
          <section id="reviews" className="scroll-mt-16">
            <div className="mx-auto max-w-6xl px-5 pb-14 sm:px-8">
              <p
                className="text-xs font-semibold tracking-[0.08em]"
                style={{ color: "var(--ink-accent)" }}
              >
                AI 마케터 실제 고객 후기
              </p>
              <WordReveal
                as="h2"
                lines={["직접 써보신", "대표님들의 말"]}
                className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tighter sm:text-6xl"
              />
            </div>

            <HorizontalPan
              className="pb-20 md:pb-0"
              trackClassName="gap-5 px-5 sm:px-8"
            >
              {REVIEWS.map((review) => {
                const isLong = quoteLength(review.quote) > 120;
                return (
                  <article
                    key={review.name}
                    className={`ink-pan-panel flex shrink-0 flex-col justify-between rounded-3xl border p-7 sm:p-9 ${
                      isLong ? "w-[84vw] md:w-[34rem]" : "w-[84vw] md:w-[24rem]"
                    }`}
                    style={{
                      borderColor: "var(--ink-line-strong)",
                      background: "var(--ink-raised)",
                    }}
                  >
                    <div>
                      {review.score !== undefined ? (
                        <p className="font-mono text-4xl font-semibold tabular-nums sm:text-5xl">
                          <span style={{ color: "var(--ink-accent)" }}>
                            {review.score}
                          </span>
                          <span
                            className="text-2xl sm:text-3xl"
                            style={{ color: "var(--ink-muted)" }}
                          >
                            /10
                          </span>
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {review.notes?.map((note, index) => (
                            <p
                              key={note}
                              className="text-sm font-semibold leading-snug"
                              style={{
                                // The programme label leads in accent; the
                                // customer's own credential sits under it in
                                // full weight so it reads as the stronger fact.
                                color:
                                  index === 0
                                    ? "var(--ink-accent)"
                                    : "var(--ink-text)",
                              }}
                            >
                              {note}
                            </p>
                          ))}
                        </div>
                      )}

                      <blockquote
                        className="mt-7 text-base leading-relaxed sm:text-lg"
                        style={{ color: "var(--ink-text-soft)" }}
                      >
                        {renderQuote(review.quote)}
                      </blockquote>
                    </div>

                    <footer
                      className="mt-9 border-t pt-6"
                      style={{ borderColor: "var(--ink-line)" }}
                    >
                      <p className="text-base font-semibold">{review.name}</p>
                      <p
                        className="mt-1 text-sm"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        {review.role}
                      </p>
                    </footer>
                  </article>
                );
              })}
            </HorizontalPan>
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
                  이번 달부터 시작해 보시겠어요?
                </h2>
                <p
                  className="mx-auto mt-5 max-w-md text-base leading-relaxed sm:text-lg"
                  style={{ color: "var(--ink-muted)" }}
                >
                  AI 마케터 1명 1개월 33만원부터 시작합니다.
                </p>
                <button
                  type="button"
                  onClick={onApply}
                  className="group mt-9 inline-flex items-center gap-2 rounded-full px-7 py-4 text-sm font-semibold text-white transition-transform duration-300 hover:-translate-y-0.5"
                  style={{ background: "var(--ink-accent)" }}
                >
                  신청하기
                  <ArrowUpRight
                    size={16}
                    weight="bold"
                    className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  />
                </button>
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
              <Link href="/tools" className="hover:text-[color:var(--ink-text)]">
                게시물 AI 생성기
              </Link>
              <Link
                href="/landing-ai"
                className="hover:text-[color:var(--ink-text)]"
              >
                랜딩페이지 개발 AI
              </Link>
              <Link
                href="/pricing"
                className="hover:text-[color:var(--ink-text)]"
              >
                가격 안내
              </Link>
            </div>
          </div>
        </footer>
      </MotionRoot>
    </div>
  );
}
