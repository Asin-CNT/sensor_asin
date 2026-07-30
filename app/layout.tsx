import "./globals.css";
import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";

const notoSansKr = Noto_Sans_KR({
  weight: ["400", "500", "600", "700"],
  preload: false,
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI 예측모델 — 크랙센서 대시보드",
  description: "현장·기간 선택 시 크랙센서 실측·예측 그래프를 실시간 반영",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={notoSansKr.className}>
        {children}
        {/* 날짜 달력 팝업용 포털 — 헤더의 overflow:hidden 에 잘리지 않게 body 최상단에 렌더 */}
        <div id="dp-portal" />
      </body>
    </html>
  );
}
