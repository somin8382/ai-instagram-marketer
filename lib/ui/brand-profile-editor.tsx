"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";
import { persistAccountProfile } from "@/lib/supabase/persistence";
import { checkSocialUrl } from "@/lib/client/social-url";

type BrandProfile = {
  company_name: string | null;
  brand_name: string | null;
  industry: string | null;
  product_service: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
};

const fieldCls =
  "w-full px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:border-gray-400";

function UrlStatusLine({
  value,
  platform,
}: {
  value: string;
  platform: "instagram" | "youtube";
}) {
  const check = checkSocialUrl(value, platform);
  if (!check) return null;
  const color =
    check.status === "ok"
      ? "text-green-600"
      : check.status === "invalid"
        ? "text-red-500"
        : "text-amber-600";
  return (
    <p className={`text-xs ${color}`}>
      {check.statusLabel}
      {check.kindLabel && ` · ${check.kindLabel}`} — {check.message}
    </p>
  );
}

/**
 * My Page section for viewing/editing the AI-generator inputs the user
 * submitted at onboarding (profiles row). Reuses the same persistence path
 * as the tools onboarding modal (persistAccountProfile).
 */
export function BrandProfileEditor({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<BrandProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [form, setForm] = useState({
    companyName: "",
    brandName: "",
    industry: "",
    productService: "",
    instagramUrl: "",
    youtubeUrl: "",
  });

  // Brand slogan generator (text-only, no credit consumption)
  const [slogans, setSlogans] = useState<Array<{ text: string; angle: string }>>(
    []
  );
  const [generatingSlogans, setGeneratingSlogans] = useState(false);
  const [sloganError, setSloganError] = useState<string | null>(null);
  const [copiedSlogan, setCopiedSlogan] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    const supabase = getSupabaseBrowserClientOrNull();
    if (!supabase || !userId) return;
    const { data } = (await (supabase
      .from("profiles")
      .select(
        "company_name, brand_name, industry, product_service, instagram_url, youtube_url"
      )
      .eq("id", userId)
      .maybeSingle() as unknown as Promise<{
      data: BrandProfile | null;
      error: { message: string } | null;
    }>)) as { data: BrandProfile | null };
    if (data) setProfile(data);
  }, [userId]);

  useEffect(() => {
    void (async () => {
      await loadProfile();
    })();
  }, [loadProfile]);

  function openEditor() {
    setForm({
      companyName: profile?.company_name ?? "",
      brandName: profile?.brand_name ?? "",
      industry: profile?.industry ?? "",
      productService: profile?.product_service ?? "",
      instagramUrl: profile?.instagram_url ?? "",
      youtubeUrl: profile?.youtube_url ?? "",
    });
    setSaveResult(null);
    setEditing(true);
  }

  async function save() {
    if (saving) return;
    if (!form.companyName.trim() || !form.industry.trim() || !form.productService.trim()) {
      setSaveResult("오류: 회사명, 업종, 상품·서비스 소개는 필수입니다.");
      return;
    }
    const instagramCheck = checkSocialUrl(form.instagramUrl, "instagram");
    const youtubeCheck = checkSocialUrl(form.youtubeUrl, "youtube");
    if (instagramCheck?.status === "invalid" || youtubeCheck?.status === "invalid") {
      setSaveResult("오류: URL 형식을 확인해주세요.");
      return;
    }
    setSaving(true);
    setSaveResult(null);
    try {
      const result = await persistAccountProfile({
        userId,
        companyName: form.companyName,
        brandName: form.brandName,
        industry: form.industry,
        productService: form.productService,
        // Save the normalized URL when available
        instagramUrl: instagramCheck?.normalized ?? form.instagramUrl,
        youtubeUrl: youtubeCheck?.normalized ?? form.youtubeUrl,
      });
      if (result.error) {
        setSaveResult("오류: 저장에 실패했습니다. 다시 시도해주세요.");
        return;
      }
      await loadProfile();
      setSaveResult("저장되었습니다.");
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function generateSlogans() {
    if (generatingSlogans || !profile) return;
    setGeneratingSlogans(true);
    setSloganError(null);
    try {
      const supabase = getSupabaseBrowserClientOrNull();
      const {
        data: { session },
      } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
      const accessToken = session?.access_token ?? "";
      if (!accessToken) {
        setSloganError("로그인 정보가 만료되었습니다. 다시 로그인해주세요.");
        return;
      }
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "brand_slogans",
          accessToken,
          companyName: profile.company_name ?? "",
          brandName: profile.brand_name ?? "",
          industry: profile.industry ?? "",
          productService: profile.product_service ?? "",
        }),
      });
      const data = (await res.json()) as {
        slogans?: Array<{ text: string; angle: string }>;
        error?: string;
      };
      if (!res.ok || !data.slogans?.length) {
        setSloganError(data.error ?? "슬로건 생성에 실패했습니다.");
        return;
      }
      setSlogans(data.slogans);
    } catch {
      setSloganError("슬로건 생성에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setGeneratingSlogans(false);
    }
  }

  async function copySlogan(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSlogan(text);
      setTimeout(() => setCopiedSlogan(null), 1500);
    } catch {
      // Clipboard unavailable — ignore
    }
  }

  if (!profile) return null;

  const summaryRows: Array<[string, string | null]> = [
    ["회사명", profile.company_name],
    ["브랜드 / 아이템명", profile.brand_name],
    ["업종", profile.industry],
    ["상품 · 서비스", profile.product_service],
    ["인스타그램", profile.instagram_url],
    ["유튜브", profile.youtube_url],
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">
          AI 생성기 입력 정보
        </p>
        <button
          onClick={openEditor}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          수정하기
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {summaryRows.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <span className="text-gray-400 shrink-0 w-28">{label}</span>
            <span className="text-gray-800 break-all">{value || "—"}</span>
          </div>
        ))}
      </div>
      {saveResult && !editing && (
        <p className="text-sm text-green-600">{saveResult}</p>
      )}

      {/* Brand slogan generator */}
      <div className="border-t border-gray-100 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">브랜드 슬로건</p>
            <p className="text-xs text-gray-500">
              입력하신 브랜드 정보로 슬로건 후보 5개를 만들어드립니다 (무료)
            </p>
          </div>
          <button
            onClick={() => void generateSlogans()}
            disabled={generatingSlogans}
            className="shrink-0 text-sm px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition-colors disabled:opacity-40"
          >
            {generatingSlogans
              ? "생성 중..."
              : slogans.length > 0
                ? "다시 생성"
                : "슬로건 생성"}
          </button>
        </div>
        {sloganError && <p className="text-sm text-red-500">{sloganError}</p>}
        {slogans.length > 0 && (
          <div className="space-y-1.5">
            {slogans.map((slogan) => (
              <div
                key={slogan.text}
                className="flex items-center justify-between gap-3 px-3 py-2 bg-violet-50/50 border border-violet-100 rounded-xl"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {slogan.text}
                  </p>
                  {slogan.angle && (
                    <p className="text-xs text-gray-500">{slogan.angle}</p>
                  )}
                </div>
                <button
                  onClick={() => void copySlogan(slogan.text)}
                  className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg border border-violet-200 text-violet-600 hover:bg-violet-100 transition-colors"
                >
                  {copiedSlogan === slogan.text ? "복사됨 ✓" : "복사"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90dvh] overflow-y-auto p-6 space-y-4 shadow-xl">
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                AI 생성기 입력 정보 수정
              </h2>
              <button
                onClick={() => setEditing(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            {(
              [
                ["companyName", "회사명 *", "예: 큐밋"],
                ["brandName", "브랜드 / 아이템명", "예: AI 게시물 생성기"],
                ["industry", "업종 *", "예: 카페 · 디저트"],
                [
                  "productService",
                  "판매 상품 · 서비스 한줄 소개 *",
                  "예: 소상공인을 위한 SNS 게시물 자동 생성 서비스",
                ],
              ] as Array<[keyof typeof form, string, string]>
            ).map(([field, label, placeholder]) => (
              <div key={field} className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  {label}
                </label>
                <input
                  type="text"
                  value={form[field]}
                  onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                  placeholder={placeholder}
                  className={fieldCls}
                />
              </div>
            ))}

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">
                인스타그램 URL
              </label>
              <input
                type="url"
                value={form.instagramUrl}
                onChange={(e) => setForm({ ...form, instagramUrl: e.target.value })}
                placeholder="https://instagram.com/..."
                className={fieldCls}
              />
              <UrlStatusLine value={form.instagramUrl} platform="instagram" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">
                유튜브 URL
              </label>
              <input
                type="url"
                value={form.youtubeUrl}
                onChange={(e) => setForm({ ...form, youtubeUrl: e.target.value })}
                placeholder="https://youtube.com/@..."
                className={fieldCls}
              />
              <UrlStatusLine value={form.youtubeUrl} platform="youtube" />
            </div>

            {saveResult && (
              <p
                className={`text-sm ${saveResult.startsWith("오류") ? "text-red-500" : "text-green-600"}`}
              >
                {saveResult}
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => void save()}
                disabled={saving}
                className="flex-1 py-3 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-40"
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
