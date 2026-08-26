"use client";

import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { useRef, useState } from "react";

const EXAMPLES = [
  "성수동 수제버거집이고, 시그니처 버거 3개랑 웨이팅 안내를 먼저 보여주고 싶어요",
  "6개월 된 필라테스 스튜디오입니다. 체험 수업 신청을 가장 크게 넣어주세요",
  "제주에서 직접 로스팅하는 원두 브랜드예요. 산지 이야기랑 정기배송 안내가 필요합니다",
];

const MAX_LENGTH = 500;

export function PromptConsole() {
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const isEmpty = prompt.trim().length === 0;

  function handleSubmit() {
    if (isEmpty) {
      setStatus("만들고 싶은 페이지를 먼저 적어주세요.");
      fieldRef.current?.focus();
      return;
    }
    setStatus(
      "아직 생성 기능이 열리지 않았습니다. 사전 신청해 두시면 열리는 대로 연락드립니다."
    );
  }

  function applyExample(example: string) {
    setPrompt(example);
    setStatus(null);
    fieldRef.current?.focus();
  }

  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl border p-5 sm:p-6 transition-colors duration-300"
        style={{
          background: "var(--ink-raised)",
          borderColor: isFocused ? "var(--ink-accent)" : "var(--ink-line-strong)",
        }}
      >
        <label
          htmlFor="landing-prompt"
          className="block text-sm font-medium"
          style={{ color: "var(--ink-muted)" }}
        >
          어떤 페이지가 필요하신가요?
        </label>

        <textarea
          id="landing-prompt"
          ref={fieldRef}
          rows={4}
          maxLength={MAX_LENGTH}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="가게가 무엇을 파는지, 무엇을 먼저 보여주고 싶은지 적어주세요."
          className="mt-3 w-full resize-none bg-transparent text-lg leading-relaxed outline-none placeholder:opacity-45"
          style={{ color: "var(--ink-text)" }}
        />

        <div
          className="mt-4 flex items-center justify-between gap-4 border-t pt-4"
          style={{ borderColor: "var(--ink-line)" }}
        >
          <span
            className="font-mono text-xs tabular-nums"
            style={{ color: "var(--ink-muted)" }}
          >
            {prompt.length}/{MAX_LENGTH}
          </span>

          <button
            type="button"
            onClick={handleSubmit}
            className="group inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-transform duration-300 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
            style={{
              background: isEmpty ? "var(--ink-accent-quiet)" : "var(--ink-accent)",
              color: isEmpty ? "var(--ink-muted)" : "#ffffff",
              outlineColor: "var(--ink-accent)",
            }}
          >
            페이지 만들기
            <ArrowRight
              size={16}
              weight="bold"
              className="transition-transform duration-300 group-hover:translate-x-0.5"
            />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium" style={{ color: "var(--ink-muted)" }}>
          이렇게 적으면 됩니다
        </p>
        <div className="grid gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => applyExample(example)}
              className="rounded-xl border border-[color:var(--ink-line)] px-4 py-3 text-left text-sm leading-relaxed text-[color:var(--ink-muted)] transition-colors duration-200 hover:border-[color:var(--ink-accent)] hover:text-[color:var(--ink-text)] focus-visible:border-[color:var(--ink-accent)] focus-visible:outline-none"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      <p
        aria-live="polite"
        className="flex min-h-6 items-center gap-2 text-sm"
        style={{ color: status ? "var(--ink-text)" : "transparent" }}
      >
        {status ? (
          <>
            <Info size={15} weight="bold" style={{ color: "var(--ink-accent)" }} />
            {status}
          </>
        ) : null}
      </p>
    </div>
  );
}
