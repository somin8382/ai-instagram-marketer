import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SERVICE_VERSION } from "@/lib/constants/version";
import { InquiryWidget } from "@/lib/ui/inquiry-widget";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI 인스타그램 마케터",
  description: "단돈 10만원에 AI 인스타그램 마케터를 고용하세요",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="flex-1">{children}</div>
        <InquiryWidget />
        <div
          aria-hidden="true"
          className="pointer-events-none fixed bottom-3 right-3 z-50 text-[11px] leading-none text-[#999] opacity-70 sm:bottom-4 sm:right-4"
        >
          {SERVICE_VERSION}
        </div>
        <footer className="border-t border-gray-200 py-8 px-4">
          <div className="max-w-4xl mx-auto text-center text-sm text-gray-500 leading-relaxed space-y-1">
            <p>© 2025 Qmeet. All rights reserved.</p>
            <p>큐밋(Qmeet)</p>
            <p>
              <a
                href="/pricing"
                className="underline underline-offset-2 hover:text-gray-700 transition-colors font-medium text-gray-600"
              >
                가격 안내
              </a>
            </p>
            <p>
              1:1 문의 (모두의창업 전용){" "}
              <a
                href="https://open.kakao.com/o/s0Viuxzi"
                className="underline underline-offset-2 hover:text-gray-700 transition-colors"
              >
                https://open.kakao.com/o/s0Viuxzi
              </a>
            </p>
            <p>
              비즈니스 문의{" "}
              <a
                href="mailto:ceo.qmeet@gmail.com"
                className="underline underline-offset-2 hover:text-gray-700 transition-colors"
              >
                ceo.qmeet@gmail.com
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
