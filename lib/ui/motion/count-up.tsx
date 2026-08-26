"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useLayoutEffect, useRef } from "react";

const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Counts from `from` to `to` when the number scrolls into view.
 *
 * The final value is what the markup renders, so the figure is correct without
 * JavaScript and correct for assistive tech; GSAP only rewrites the visible
 * text while the tween runs. Digits are tabular so the row does not jitter as
 * the value grows.
 */
export function CountUp({
  from,
  to,
  prefix = "",
  suffix = "",
  decimals = 0,
  duration = 1.6,
  className = "",
}: {
  from: number;
  to: number;
  prefix?: string;
  suffix?: string;
  /** Ratings land on a fraction (평균 9.4); counts stay whole. */
  decimals?: number;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const format = (value: number) =>
    `${prefix}${value.toLocaleString("ko-KR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`;

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const counter = { value: from };
      el.textContent = format(from);

      // Trigger and tween are decoupled: a ScrollTrigger.refresh() during
      // playback must not revert a tween that is already running.
      ScrollTrigger.create({
        trigger: el,
        start: "top 85%",
        once: true,
        onEnter: () => {
          gsap.to(counter, {
            value: to,
            duration,
            ease: "power2.out",
            onUpdate: () => {
              el.textContent = format(counter.value);
            },
          });
        },
      });
    }, el);

    return () => ctx.revert();
  }, [from, to, prefix, suffix, decimals, duration]);

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {format(to)}
    </span>
  );
}
