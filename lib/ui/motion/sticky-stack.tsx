"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useLayoutEffect, useRef } from "react";

const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export type StackScene = {
  verb: string;
  title: string;
  body: string;
};

// Where the outgoing scene starts receding, expressed as the incoming scene's
// top position in the viewport. The incoming scene climbs from 100% to 0%, so
// this value is also the dwell: the scene holds fully readable for the first 60%
// of that climb, then hands off over the last 40%. Fading across the whole climb
// (the naive "top bottom" start) leaves every scene looking like a ghost.
const RECEDE_START = "top 40%";

/**
 * Sticky-stack: each scene pins at the viewport top and the outgoing scene
 * recedes as the next one climbs over it. Used for the three-beat build story,
 * where the sequence itself is the message.
 *
 * The scenes are sticky siblings sharing one containing block: each sticks at
 * top:0 and the next paints over it. That is CSS, not a ScrollTrigger pin, so
 * there is no pin-spacer to jump on mobile. GSAP only scrubs transform and
 * opacity, and only on the inner content: the sticky section keeps an
 * untransformed background so the receding scene never lets the page show
 * through behind it.
 */
export function StickyStack({ scenes }: { scenes: StackScene[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const sceneEls = gsap.utils.toArray<HTMLElement>("[data-scene]");

      sceneEls.forEach((scene, index) => {
        const next = sceneEls[index + 1];
        const inner = scene.querySelector<HTMLElement>("[data-scene-inner]");
        if (!next || !inner) return;

        // One tween owns opacity on this element. A second entry tween on the
        // same property would fight this one and leave scenes half-faded.
        gsap.to(inner, {
          scale: 0.94,
          opacity: 0.28,
          ease: "none",
          scrollTrigger: {
            trigger: next,
            start: RECEDE_START,
            end: "top top",
            scrub: true,
            invalidateOnRefresh: true,
          },
        });
      });
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={ref} className="relative">
      {scenes.map((scene) => (
        <section
          key={scene.verb}
          data-scene
          className="sticky top-0 flex min-h-[100dvh] items-center"
          style={{ background: "var(--ink-bg)" }}
        >
          <div
            data-scene-inner
            className="mx-auto w-full max-w-6xl px-5 sm:px-8"
            style={{ willChange: "transform, opacity" }}
          >
            <div className="h-px w-full" style={{ background: "var(--ink-line)" }} />
            <div className="grid grid-cols-1 gap-8 pt-10 md:grid-cols-12 md:gap-6 md:pt-14">
              <h3 className="md:col-span-5 text-5xl sm:text-7xl md:text-8xl font-semibold tracking-tighter leading-[1.12]">
                {scene.verb}
              </h3>
              <div className="md:col-span-6 md:col-start-7 space-y-5">
                <p className="text-2xl sm:text-3xl font-medium tracking-tight leading-snug">
                  {scene.title}
                </p>
                <p
                  className="text-base sm:text-lg leading-relaxed max-w-[46ch]"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {scene.body}
                </p>
              </div>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
