"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import "@/lib/ui/motion/motion.css";
import "@/lib/ui/ink-app.css";

/**
 * App-wide surface theme. Dark is the default everywhere; light is opt-in and
 * remembered.
 *
 * The light palette is the one the pages were authored in, so "light" is
 * simply the absence of the dark layer — there is no second set of styles to
 * keep in sync. `ink-app.css` retones the light utilities when the dark class
 * is present.
 *
 * localStorage is an external store, so it is read through
 * useSyncExternalStore rather than an effect: the server snapshot is always
 * dark (matching the default), so hydration never disagrees, and no component
 * sets state during an effect.
 */
export type AppTheme = "dark" | "light";

const STORAGE_KEY = "qmeet-theme";
const CHANGE_EVENT = "qmeet-theme-change";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function getSnapshot(): AppTheme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "light"
      ? "light"
      : "dark";
  } catch {
    // Storage blocked (private mode): fall back to the default.
    return "dark";
  }
}

function getServerSnapshot(): AppTheme {
  return "dark";
}

export function useAppTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggleTheme() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        theme === "dark" ? "light" : "dark"
      );
    } catch {
      // Nothing to persist to; the event below still repaints this tab.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return { theme, isDark: theme === "dark", toggleTheme };
}

/**
 * Wraps a page so it follows the chosen theme. Pages keep their own light
 * markup; this only adds the dark layer on top when dark is active.
 *
 * `accent` tints the wash at the top of the viewport so each page keeps the
 * hue it is already built around (마케터=rose, 생성기=violet, 브랜드=emerald).
 */
const GLOW_RGB = {
  violet: "139, 92, 246",
  rose: "244, 63, 94",
  emerald: "16, 185, 129",
} as const;

export function AppSurface({
  children,
  className = "",
  glow = true,
  accent = "violet",
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  accent?: keyof typeof GLOW_RGB;
}) {
  const { isDark } = useAppTheme();
  const rgb = GLOW_RGB[accent];

  return (
    <div
      className={`${
        isDark ? "ink-surface ink-grain ink-app" : "bg-[#f8f9fb]"
      } ${className}`}
    >
      {glow ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 h-[32rem]"
          style={{
            background: `radial-gradient(56rem 28rem at 50% -8rem, rgba(${rgb}, ${
              isDark ? 0.16 : 0.05
            }), transparent 70%)`,
          }}
        />
      ) : null}
      {children}
    </div>
  );
}

/** Text-link switch matching the header links it sits beside. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { isDark, toggleTheme } = useAppTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={className}
      aria-label={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
    >
      {isDark ? "라이트 모드" : "다크 모드"}
    </button>
  );
}
