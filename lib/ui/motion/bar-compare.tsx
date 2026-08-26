"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useLayoutEffect, useRef } from "react";

const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type CompareRow = {
  label: string;
  value: number;
  valueLabel: string;
  /** The row being argued for. Drawn in the accent and grown last. */
  highlight?: boolean;
};

/**
 * Two costs side by side as proportional bars. Length carries the comparison —
 * the ratio is the argument, so the bars are scaled against the largest value
 * rather than normalised per row.
 */
export function BarCompare({ rows }: { rows: CompareRow[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const max = Math.max(...rows.map((row) => row.value), 1);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const bars = el.querySelectorAll<HTMLElement>("[data-bar]");
      if (!bars.length) return;

      gsap.set(bars, { scaleX: 0, transformOrigin: "left center" });

      // Trigger and tween are decoupled so a ScrollTrigger.refresh() mid-grow
      // cannot revert a running tween (same pattern as Reveal/CountUp).
      ScrollTrigger.create({
        trigger: el,
        start: "top 85%",
        once: true,
        onEnter: () => {
          gsap.to(bars, {
            scaleX: 1,
            duration: 1.1,
            ease: "power3.out",
            stagger: 0.16,
          });
        },
      });
    }, el);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={ref} className="space-y-5">
      {rows.map((row) => (
        <div key={row.label} className="space-y-2">
          <div className="flex items-baseline justify-between gap-4">
            <span
              className="text-xs sm:text-sm"
              style={{
                color: row.highlight ? "var(--ink-text)" : "var(--ink-muted)",
              }}
            >
              {row.label}
            </span>
            <span
              className="font-mono text-sm tabular-nums sm:text-base"
              style={{
                color: row.highlight ? "var(--ink-accent)" : "var(--ink-muted)",
              }}
            >
              {row.valueLabel}
            </span>
          </div>
          <div
            className="h-2.5 w-full overflow-hidden rounded-full"
            style={{ background: "rgba(255,255,255,0.05)" }}
          >
            <div
              data-bar
              className="h-full rounded-full"
              style={{
                width: `${Math.max((row.value / max) * 100, 2)}%`,
                background: row.highlight
                  ? "var(--ink-accent)"
                  : "rgba(255,255,255,0.22)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
