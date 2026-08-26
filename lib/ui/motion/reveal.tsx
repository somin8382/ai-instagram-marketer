"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";

const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Markup renders in its final, readable state so the page still works without
// JavaScript. GSAP applies the pre-animation state before paint instead.
function splitWords(line: string) {
  return line.split(" ").filter((word) => word.length > 0);
}

/**
 * Headline reveal: each word lifts out of its own clipping mask.
 * Paces the headline ahead of the supporting copy so hierarchy reads in order.
 * The unsplit sentence stays available to assistive tech via aria-label.
 */
export function WordReveal({
  as = "h2",
  lines,
  accentWords = [],
  className = "",
  delay = 0,
}: {
  as?: "h1" | "h2";
  lines: string[];
  accentWords?: string[];
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLHeadingElement>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const words = el.querySelectorAll<HTMLElement>("[data-word]");
      // The tween is launched from onEnter rather than attached to the
      // trigger: attached from()-tweens get reverted mid-flight when
      // ScrollTrigger.refresh() fires (fonts/load) during the entrance,
      // freezing later stagger items at partial opacity.
      gsap.set(words, { yPercent: 118 });
      ScrollTrigger.create({
        trigger: el,
        start: "top 85%",
        once: true,
        onEnter: () => {
          gsap.to(words, {
            yPercent: 0,
            duration: 1,
            ease: "power4.out",
            stagger: 0.055,
            delay,
          });
        },
      });
    }, el);

    return () => ctx.revert();
  }, [delay]);

  // Rendered as a concrete tag rather than a dynamic component so the ref is
  // known to land on a host element.
  const content = lines.map((line, lineIndex) => {
    const words = splitWords(line);
    return (
      <span key={lineIndex} className="block" aria-hidden="true">
        {words.map((word, wordIndex) => (
          <Fragment key={`${lineIndex}-${wordIndex}`}>
            <span className="ink-word-mask">
              <span
                data-word
                className="inline-block"
                style={
                  accentWords.includes(word)
                    ? { color: "var(--ink-accent)" }
                    : undefined
                }
              >
                {word}
              </span>
            </span>
            {/* The space sits outside the mask, which clips its overflow. */}
            {wordIndex < words.length - 1 ? " " : null}
          </Fragment>
        ))}
      </span>
    );
  });

  const label = lines.join(" ");

  if (as === "h1") {
    return (
      <h1 ref={ref} className={className} aria-label={label}>
        {content}
      </h1>
    );
  }

  return (
    <h2 ref={ref} className={className} aria-label={label}>
      {content}
    </h2>
  );
}

/**
 * Enter-on-scroll for supporting content. Children marked `data-reveal-item`
 * stagger to guide reading order; otherwise the wrapper moves as one block.
 */
export function Reveal({
  children,
  className = "",
  y = 26,
}: {
  children: ReactNode;
  className?: string;
  y?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const items = el.querySelectorAll<HTMLElement>("[data-reveal-item]");
      const targets = items.length ? Array.from(items) : [el];
      // Trigger and tween are decoupled (see WordReveal): a refresh() during
      // the entrance must not revert a tween that is already playing.
      gsap.set(targets, { opacity: 0, y });
      ScrollTrigger.create({
        trigger: el,
        start: "top 82%",
        once: true,
        onEnter: () => {
          gsap.to(targets, {
            opacity: 1,
            y: 0,
            duration: 0.9,
            ease: "power3.out",
            stagger: items.length ? 0.08 : 0,
          });
        },
      });
    }, el);

    return () => ctx.revert();
  }, [y]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/**
 * Scroll-scrubbed word reveal. Scroll progress paces reading rather than
 * simulating a typewriter, so the sentence lands one beat at a time.
 */
export function ScrubbedSentence({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const words = splitWords(text);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      gsap.fromTo(
        el.querySelectorAll<HTMLElement>("[data-word]"),
        { opacity: 0.16 },
        {
          opacity: 1,
          ease: "none",
          stagger: 0.5,
          scrollTrigger: {
            trigger: el,
            start: "top 78%",
            end: "bottom 60%",
            scrub: 0.7,
          },
        }
      );
    }, el);

    return () => ctx.revert();
  }, []);

  return (
    <p ref={ref} className={className} aria-label={text}>
      {words.map((word, index) => (
        <Fragment key={index}>
          <span data-word aria-hidden="true" className="inline-block">
            {word}
          </span>
          {index < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </p>
  );
}
