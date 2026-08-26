"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useLayoutEffect, useRef } from "react";

const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const VIEW_W = 600;
const VIEW_H = 180;
const PAD_Y = 10;
// Where the curve's endpoints sit, as a share of the box. The dots are HTML
// overlaid at these coordinates rather than SVG circles: the viewBox scales
// non-uniformly to fill the row, which would squash a circle into an ellipse
// and clip whatever sits exactly on the edge.
const END_TOP = `${(PAD_Y / VIEW_H) * 100}%`;
const START_TOP = `${((VIEW_H - PAD_Y) / VIEW_H) * 100}%`;

// Only the two endpoints are real numbers, so the curve between them is drawn
// as one continuous accelerating sweep and carries no intermediate ticks or
// values — it shows the shape of the change, not a month-by-month record.
const CURVE = `M 0 ${VIEW_H - PAD_Y} C ${VIEW_W * 0.42} ${VIEW_H - PAD_Y}, ${
  VIEW_W * 0.62
} ${VIEW_H * 0.72}, ${VIEW_W} ${PAD_Y}`;
const AREA = `${CURVE} L ${VIEW_W} ${VIEW_H} L 0 ${VIEW_H} Z`;

/**
 * Draws a start → end growth curve when it scrolls into view: the line traces
 * itself, the fill under it fades up, and the end point lands last.
 */
export function GrowthCurve({
  startLabel,
  endLabel,
  caption,
}: {
  startLabel: string;
  endLabel: string;
  caption?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const line = el.querySelector<SVGPathElement>("[data-curve-line]");
      const area = el.querySelector<SVGPathElement>("[data-curve-area]");
      const endDot = el.querySelector<HTMLElement>("[data-curve-end]");
      if (!line || !area || !endDot) return;

      const length = line.getTotalLength();
      gsap.set(line, { strokeDasharray: length, strokeDashoffset: length });
      gsap.set([area, endDot], { opacity: 0 });

      // Trigger and tween are decoupled so a ScrollTrigger.refresh() mid-draw
      // cannot revert a running tween (same pattern as Reveal/CountUp).
      ScrollTrigger.create({
        trigger: el,
        start: "top 85%",
        once: true,
        onEnter: () => {
          const tl = gsap.timeline();
          tl.to(line, {
            strokeDashoffset: 0,
            duration: 1.6,
            ease: "power2.out",
          })
            .to(area, { opacity: 1, duration: 0.9, ease: "power2.out" }, 0.35)
            .fromTo(
              endDot,
              { opacity: 0, scale: 0.4 },
              { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(2.4)" },
              1.25
            );
        },
      });
    }, el);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={ref} className="w-full">
      <div className="relative h-28 w-full sm:h-36">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label={`${startLabel}에서 ${endLabel}으로 증가`}
        >
          <defs>
            <linearGradient id="growth-fill" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--ink-accent)"
                stopOpacity="0.28"
              />
              <stop
                offset="100%"
                stopColor="var(--ink-accent)"
                stopOpacity="0"
              />
            </linearGradient>
          </defs>

          <path data-curve-area d={AREA} fill="url(#growth-fill)" />
          <path
            data-curve-line
            d={CURVE}
            fill="none"
            stroke="var(--ink-accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <span
          aria-hidden="true"
          className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{
            top: START_TOP,
            left: 0,
            background: "var(--ink-bg)",
            borderColor: "var(--ink-muted)",
          }}
        />
        <span
          data-curve-end
          aria-hidden="true"
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            top: END_TOP,
            left: "100%",
            background: "var(--ink-accent)",
            boxShadow: "0 0 0 6px color-mix(in srgb, var(--ink-accent) 18%, transparent)",
          }}
        />
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-4">
        <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {startLabel}
        </span>
        {caption ? (
          <span
            className="text-[11px] text-center"
            style={{ color: "var(--ink-muted)" }}
          >
            {caption}
          </span>
        ) : null}
        <span
          className="text-xs font-semibold"
          style={{ color: "var(--ink-accent)" }}
        >
          {endLabel}
        </span>
      </div>
    </div>
  );
}
