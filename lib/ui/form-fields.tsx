"use client";

import {
  getHelperTextClass,
  getTextFieldClass,
  type FeedbackTheme,
} from "@/lib/ui/form-feedback";

// Extracted from app/tools/page.tsx: the labeled input/textarea pattern used
// throughout the 게시물 생성기 flow, shared so other workspace tools (브랜드
// 아이덴티티, ...) get identical field chrome instead of a lookalike.

export function InputField({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  required = false,
  error,
  fieldKey,
  theme = "violet",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  error?: string;
  fieldKey?: string;
  theme?: FeedbackTheme;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        data-validation-field={fieldKey}
        aria-invalid={Boolean(error)}
        className={getTextFieldClass({ theme, hasError: Boolean(error) })}
      />
      {error && <p className={getHelperTextClass(theme)}>{error}</p>}
    </div>
  );
}

export function TextareaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  error,
  fieldKey,
  theme = "violet",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  error?: string;
  fieldKey?: string;
  theme?: FeedbackTheme;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        data-validation-field={fieldKey}
        aria-invalid={Boolean(error)}
        className={`${getTextFieldClass({
          theme,
          hasError: Boolean(error),
        })} resize-none`}
      />
      {error && <p className={getHelperTextClass(theme)}>{error}</p>}
    </div>
  );
}
