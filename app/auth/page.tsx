"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getSupabaseBrowserClient,
  getSupabaseBrowserClientOrNull,
  hasSupabaseEnv,
} from "@/lib/supabase/client";
import { syncProfileAndLinkData } from "@/lib/supabase/persistence";

const APP_STORAGE_KEY = "qmeet-app-state";

type AuthTab = "login" | "signup";

function AuthInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-300 transition-colors bg-white"
      />
    </div>
  );
}

function AuthPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<AuthTab>(() =>
    searchParams.get("tab") === "login" ? "login" : "signup"
  );
  const [authError, setAuthError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [signupPendingEmail, setSignupPendingEmail] = useState("");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupPasswordConfirm, setSignupPasswordConfirm] = useState("");

  const redirectTarget = useMemo(() => {
    const redirect = searchParams.get("redirect");
    if (redirect === "landing") return "landing";
    return redirect === "postgen" ? "postgen" : "status";
  }, [searchParams]);

  const redirectHref = useMemo(() => {
    if (redirectTarget === "landing") {
      return "/?screen=landing";
    }

    return `/?screen=${redirectTarget}`;
  }, [redirectTarget]);

  const supabaseReady = hasSupabaseEnv();

  function getRequestEmail() {
    if (typeof window === "undefined") return "";

    const savedAppState = window.localStorage.getItem(APP_STORAGE_KEY);
    if (!savedAppState) return "";

    try {
      const parsed = JSON.parse(savedAppState) as { email?: string };
      return parsed.email ?? "";
    } catch {
      return "";
    }
  }

  const completeAuth = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      throw new Error("로그인 정보를 확인하지 못했습니다. 다시 시도해주세요.");
    }

    await syncProfileAndLinkData({
      user,
      requestEmail: getRequestEmail(),
    });

    router.replace(redirectHref);
  }, [redirectHref, router]);

  function toKoreanAuthError(message?: string) {
    if (!message) {
      return "잠시 후 다시 시도해주세요.";
    }

    if (message.includes("Invalid login credentials")) {
      return "이메일 또는 비밀번호가 올바르지 않습니다.";
    }

    if (message.includes("User already registered")) {
      return "이미 가입된 이메일입니다. 로그인으로 진행해주세요.";
    }

    if (message.includes("Password should be")) {
      return "비밀번호 형식을 다시 확인해주세요.";
    }

    if (message.includes("Email not confirmed")) {
      return "이메일 인증이 아직 완료되지 않았습니다. 메일함의 인증 링크를 눌러주세요.";
    }

    return "인증 처리 중 문제가 발생했습니다. 다시 시도해주세요.";
  }

  function isDuplicateSignupError(message?: string) {
    if (!message) return false;

    const normalized = message.toLowerCase();

    return (
      normalized.includes("user already registered") ||
      normalized.includes("already registered") ||
      normalized.includes("email address is already registered") ||
      normalized.includes("already been registered")
    );
  }

  useEffect(() => {
    const supabase = getSupabaseBrowserClientOrNull();

    if (!supabase) {
      return;
    }

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (data.session?.user) {
          await completeAuth();
        }
      })
      .catch(() => undefined);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") &&
        session?.user
      ) {
        void completeAuth();
      }
    });

    return () => subscription.unsubscribe();
  }, [completeAuth]);

  async function handleLogin() {
    setAuthError("");
    setSubmitting(true);

    if (!loginEmail.trim() || !loginPassword.trim()) {
      setAuthError("이메일과 비밀번호를 입력해주세요");
      setSubmitting(false);
      return;
    }

    if (!supabaseReady) {
      setAuthError("Supabase 연결 정보를 다시 확인해주세요.");
      setSubmitting(false);
      return;
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPassword,
      });

      if (error) {
        throw error;
      }

      await completeAuth();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setAuthError(toKoreanAuthError(message));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignup() {
    setAuthError("");
    setSubmitting(true);

    if (
      !signupName.trim() ||
      !signupEmail.trim() ||
      !signupPassword.trim() ||
      !signupPasswordConfirm.trim()
    ) {
      setAuthError("모든 항목을 입력해주세요");
      setSubmitting(false);
      return;
    }

    if (signupPassword !== signupPasswordConfirm) {
      setAuthError("비밀번호가 서로 다릅니다");
      setSubmitting(false);
      return;
    }

    if (!supabaseReady) {
      setAuthError("Supabase 연결 정보를 다시 확인해주세요.");
      setSubmitting(false);
      return;
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signUp({
        email: signupEmail.trim(),
        password: signupPassword,
        options: {
          data: {
            name: signupName.trim(),
          },
        },
      });

      if (error) {
        if (isDuplicateSignupError(error.message)) {
          setTab("login");
          setLoginEmail(signupEmail.trim());
          setLoginPassword("");
          setAuthError(
            "이미 가입된 이메일입니다. 로그인 탭에서 바로 로그인할 수 있습니다."
          );
          return;
        }

        throw error;
      }

      if (!data.user || !data.session) {
        setSignupPendingEmail(signupEmail.trim());
        return;
      }

      await completeAuth();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setAuthError(toKoreanAuthError(message));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f8f9fb] flex items-center justify-center px-4 py-12">
      <div className="max-w-xl w-full space-y-6">
        <button
          onClick={() => router.push(redirectHref)}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
        >
          ← 뒤로
        </button>

        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 bg-violet-50 text-violet-600 text-xs font-semibold px-4 py-1.5 rounded-full border border-violet-100">
            계정 연결
          </div>
          <h1 className="text-3xl font-bold text-gray-900">
            회원가입 또는 로그인
          </h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            회원가입 후 진행 상태 확인과 게시물 AI 생성 기능을 이용할 수 있습니다
          </p>
          {!supabaseReady && (
            <p className="text-xs text-red-500">
              연결 정보가 반영되지 않았습니다. 개발 서버를 다시 시작해주세요.
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
          <div className="grid grid-cols-2 gap-2 p-1 bg-gray-50 rounded-2xl">
            <button
              type="button"
              onClick={() => {
                setTab("signup");
                setAuthError("");
                setSignupPendingEmail("");
              }}
              className={`py-3 rounded-xl text-sm font-semibold transition-colors ${
                tab === "signup"
                  ? "bg-white text-violet-600 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              회원가입
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("login");
                setAuthError("");
                setSignupPendingEmail("");
              }}
              className={`py-3 rounded-xl text-sm font-semibold transition-colors ${
                tab === "login"
                  ? "bg-white text-violet-600 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              로그인
            </button>
          </div>

          {tab === "signup" ? (
            <div className="space-y-4">
              {signupPendingEmail ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-5 space-y-3">
                    <div className="space-y-1">
                      <p className="text-lg font-bold text-gray-900">
                        이메일 인증이 필요합니다
                      </p>
                      <p className="text-sm text-gray-600">
                        입력하신 이메일로 인증 메일을 보냈습니다
                      </p>
                      <p className="text-sm font-medium text-violet-700">
                        {signupPendingEmail}
                      </p>
                    </div>
                    <div className="space-y-2 text-sm text-gray-600 leading-relaxed">
                      <p>메일함에서 인증 링크를 눌러 회원가입을 완료해주세요</p>
                      <p>메일이 보이지 않으면 스팸함도 함께 확인해주세요</p>
                      <p>
                        보낸 사람 이름이 익숙하지 않을 수 있으니 제목과 발신 주소를
                        함께 확인해주세요
                      </p>
                      <p>
                        기본 인증 메일로 발송될 수 있으니 회원가입 인증 메일도 함께
                        확인해주세요
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setTab("login");
                        setSignupPendingEmail("");
                        setLoginEmail(signupEmail.trim() || signupPendingEmail);
                        setAuthError("");
                      }}
                      className="w-full py-3 bg-gradient-to-r from-violet-500 to-purple-500 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
                    >
                      인증 후 로그인하기
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSignupPendingEmail("");
                        setAuthError("");
                      }}
                      className="w-full py-3 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      다른 이메일로 가입하기
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-500">
                    신청 시 입력한 이메일로 가입하시면 진행 정보가 자동 연결됩니다
                  </p>
                  <p className="text-xs text-gray-500">
                    이미 계정이 있으신가요? 로그인 탭에서 바로 이어서 이용하실 수 있습니다
                  </p>
                  <AuthInput
                    label="이름"
                    value={signupName}
                    onChange={setSignupName}
                    placeholder="홍길동"
                  />
                  <AuthInput
                    label="이메일"
                    value={signupEmail}
                    onChange={setSignupEmail}
                    type="email"
                    placeholder="예: brand@company.com"
                  />
                  <AuthInput
                    label="비밀번호"
                    value={signupPassword}
                    onChange={setSignupPassword}
                    type="password"
                    placeholder="비밀번호를 입력해주세요"
                  />
                  <AuthInput
                    label="비밀번호 확인"
                    value={signupPasswordConfirm}
                    onChange={setSignupPasswordConfirm}
                    type="password"
                    placeholder="비밀번호를 다시 입력해주세요"
                  />
                  <div className="space-y-3 pt-2">
                    <button
                      type="button"
                      onClick={handleSignup}
                      disabled={submitting}
                      className="w-full py-3 bg-gradient-to-r from-violet-500 to-purple-500 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
                    >
                      {submitting ? "가입 중입니다..." : "회원가입하기"}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                이미 가입한 이메일로 로그인하면 진행 상태를 바로 확인할 수 있습니다
              </p>
              <p className="text-xs text-gray-500">
                아직 회원이 아니신가요? 회원가입 탭에서 바로 시작하실 수 있습니다
              </p>
              <AuthInput
                label="이메일"
                value={loginEmail}
                onChange={setLoginEmail}
                type="email"
                placeholder="예: brand@company.com"
              />
              <AuthInput
                label="비밀번호"
                value={loginPassword}
                onChange={setLoginPassword}
                type="password"
                placeholder="비밀번호를 입력해주세요"
              />
              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  onClick={handleLogin}
                  disabled={submitting}
                  className="w-full py-3 bg-gradient-to-r from-violet-500 to-purple-500 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
                >
                  {submitting ? "로그인 중입니다..." : "로그인"}
                </button>
              </div>
            </div>
          )}

          {authError && (
            <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3">
              <p className="text-sm font-medium text-red-600">{authError}</p>
            </div>
          )}

        </div>
      </div>
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthPageInner />
    </Suspense>
  );
}
