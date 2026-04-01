"use client";

import { useEffect } from "react";

type FeedbackTheme = "rose" | "violet";

const ACTIVE_BUTTON_STYLES: Record<FeedbackTheme, string> = {
  rose:
    "bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-md hover:shadow-lg active:scale-[0.98]",
  violet:
    "bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-md hover:shadow-lg active:scale-[0.98]",
};

const INACTIVE_BUTTON_STYLES =
  "cursor-not-allowed opacity-50 shadow-none hover:shadow-none active:scale-100";

const FIELD_ERROR_STYLES: Record<FeedbackTheme, string> = {
  rose:
    "border-rose-300 bg-rose-50/40 text-gray-900 placeholder:text-rose-300 focus:ring-rose-500/20 focus:border-rose-400",
  violet:
    "border-violet-300 bg-violet-50/40 text-gray-900 placeholder:text-violet-300 focus:ring-violet-500/20 focus:border-violet-400",
};

const FIELD_DEFAULT_STYLES: Record<FeedbackTheme, string> = {
  rose:
    "border-gray-200 bg-white placeholder:text-gray-400 focus:ring-rose-500/20 focus:border-rose-300",
  violet:
    "border-gray-200 bg-white placeholder:text-gray-400 focus:ring-violet-500/20 focus:border-violet-300",
};

const HELPER_TEXT_STYLES: Record<FeedbackTheme, string> = {
  rose: "text-rose-500",
  violet: "text-violet-500",
};

export function getPrimaryActionButtonClass({
  theme,
  isInactive = false,
}: {
  theme: FeedbackTheme;
  isInactive?: boolean;
}) {
  return [
    "w-full rounded-xl font-semibold transition-all",
    ACTIVE_BUTTON_STYLES[theme],
    isInactive ? INACTIVE_BUTTON_STYLES : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function getTextFieldClass({
  theme,
  hasError,
}: {
  theme: FeedbackTheme;
  hasError?: boolean;
}) {
  return [
    "w-full px-4 py-3 border rounded-xl text-sm focus:outline-none transition-colors",
    hasError ? FIELD_ERROR_STYLES[theme] : FIELD_DEFAULT_STYLES[theme],
  ].join(" ");
}

export function getHelperTextClass(theme: FeedbackTheme) {
  return `text-xs ${HELPER_TEXT_STYLES[theme]}`;
}

export function ValidationToast({
  message,
  onClose,
  theme = "rose",
}: {
  message: string | null;
  onClose: () => void;
  theme?: FeedbackTheme;
}) {
  useEffect(() => {
    if (!message) {
      return;
    }

    const timeoutId = window.setTimeout(onClose, 2200);
    return () => window.clearTimeout(timeoutId);
  }, [message, onClose]);

  if (!message) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-5 z-50 flex justify-center px-4 pointer-events-none">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto rounded-full border bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-lg ${
          theme === "rose" ? "border-rose-100" : "border-violet-100"
        }`}
      >
        {message}
      </div>
    </div>
  );
}
