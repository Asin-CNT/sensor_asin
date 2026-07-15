"use client";
import dynamic from "next/dynamic";

// onnxruntime-web / chart.js 가 import 시점에 `window`를 참조하므로,
// 서버 프리렌더에서 터진다. 대시보드 본체는 클라이언트에서만 로드한다 (ssr:false).
const DashboardClient = dynamic(() => import("./DashboardClient"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 40, color: "var(--muted)", fontSize: 14 }}>불러오는 중…</div>
  ),
});

export default function Page() {
  return <DashboardClient />;
}
