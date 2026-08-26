"use client";

import Link from "next/link";
import { Fragment } from "react";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { MotionRoot } from "@/lib/ui/motion/motion-root";
import { HorizontalPan } from "@/lib/ui/motion/horizontal-pan";
import { Reveal, ScrubbedSentence, WordReveal } from "@/lib/ui/motion/reveal";
import { REVIEWS, quoteLength } from "@/lib/ui/reviews";
import "@/lib/ui/motion/motion.css";

const ACCENT = "#ef4a6b";

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
  const products = [
    {
      name: "AI 마케터",
      summary: "계정 기획부터 콘텐츠 운영, 마케팅 전략까지 맡깁니다.",
      price: "월 30만원부터",
      onClick: onApply,
    },
    {
      name: "게시물 AI 생성기",
      summary: "프롬프트를 넣으면 게시물 문구와 이미지가 함께 나옵니다.",
      price: "월 2만원",
      href: "/tools",
    },
    {
      name: "랜딩페이지 개발 AI",
      summary: "한 문장으로 인스타 프로필에 걸 페이지 한 장을 만듭니다.",
      price: "준비 중",
      href: "/landing-ai",
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
              <Link
                href="/auth"
                className="text-sm transition-colors hover:text-[color:var(--ink-text)]"
                style={{ color: "var(--ink-muted)" }}
              >
                로그인
              </Link>
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
                  lines={["AI 마케터를 월 30만원에", "고용하세요"]}
                  accentWords={["30만원에"]}
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

          {/* Positioning. Scroll paces the sentence one beat at a time. */}
          <section className="mx-auto max-w-4xl px-5 py-28 sm:px-8 sm:py-36">
            <ScrubbedSentence
              text="마케터 한 명을 채용하면 월 급여만 300만원이 넘습니다. 같은 일을 10분의 1 비용으로 맡길 수 있다면 어떨까요."
              className="text-2xl font-medium leading-[1.6] tracking-tight sm:text-4xl sm:leading-[1.5]"
            />
          </section>

          {/* Products */}
          <section className="mx-auto max-w-6xl px-5 pb-28 sm:px-8 sm:pb-36">
            <WordReveal
              as="h2"
              lines={["세 가지로", "나눠 두었습니다"]}
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
                  AI 마케터 1명 1개월 30만원부터 시작합니다.
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
