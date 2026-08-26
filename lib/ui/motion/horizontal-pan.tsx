"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Horizontal pan: the section pins and vertical scroll drives the track
 * sideways. Used for browsing a set where the set itself is the point, so the
 * reader moves through it at their own pace instead of scrolling a tall wall.
 *
 * Below the breakpoint the pin is never created and the track stays a native
 * swipe carousel with scroll snapping, which is what a touch device expects and
 * what a pinned section handles badly.
 */
export function HorizontalPan({
  children,
  className = "",
  trackClassName = "",
}: {
  children: ReactNode;
  className?: string;
  trackClassName?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const wrapEl = wrap.current;
    const trackEl = track.current;
    if (!wrapEl || !trackEl) return;

    gsap.registerPlugin(ScrollTrigger);
    const mm = gsap.matchMedia();

    mm.add(
      "(min-width: 768px) and (prefers-reduced-motion: no-preference)",
      () => {
        // Measured in a function so `invalidateOnRefresh` can re-read it after
        // fonts load or the window resizes.
        const distance = () => trackEl.scrollWidth - wrapEl.offsetWidth;

        gsap.to(trackEl, {
          x: () => -distance(),
          ease: "none",
          scrollTrigger: {
            trigger: wrapEl,
            start: "top top",
            end: () => `+=${distance()}`,
            pin: true,
            scrub: 1,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });
      }
    );

    return () => mm.revert();
  }, []);

  return (
    // The pinned section has to fill the viewport, otherwise the pin leaves a
    // dead band below the track and the sticky nav clips the panel tops.
    <section
      ref={wrap}
      className={`md:h-[100dvh] md:overflow-hidden ${className}`}
    >
      <div className="flex h-full items-center py-4 md:pt-20 md:pb-12">
        <div
          ref={track}
          className={`ink-pan-track flex items-stretch overflow-x-auto md:overflow-visible ${trackClassName}`}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
