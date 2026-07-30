"use client";
import { useRef } from "react";
import type { Point } from "@/lib/predictor";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js";
import { Line } from "react-chartjs-2";
import zoomPlugin from "chartjs-plugin-zoom";

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend, zoomPlugin);

// 커스텀 positioner: 활성 점들 중 가장 아래(y 최대) 점의 바로 밑에 툴팁 앵커 → 점이 안 가림
(Tooltip.positioners as any).belowLowest = function (elements: any[], eventPosition: any) {
  if (!elements.length) return eventPosition;
  let x = elements[0].element.x;
  let y = elements[0].element.y;
  for (const el of elements) if (el.element.y > y) y = el.element.y;
  return { x, y };
};

// 센서별 DB 저장 상태
export type SaveState = "saving" | "done" | "empty" | undefined;

export default function CrackCard({
  id, label, points, site, compact = false, onSave, saveState,
}: {
  id: string; label: string; points: Point[]; site?: string; compact?: boolean;
  onSave?: () => void; saveState?: SaveState;
}) {
  // 같은 시각의 |예측 − 실측| 차이 → 최소/최대 (표시 기간 기준)
  const diffs = points
    .map((p) => Math.abs(p.pred - p.actual))
    .filter((x) => Number.isFinite(x));
  const errMin = diffs.length ? Math.min(...diffs) : null;
  const errMax = diffs.length ? Math.max(...diffs) : null;

  // 95% 구간 적중률: 실측이 [lo, hi] 안에 들어가면 1, 아니면 0 → 평균
  const valid = points.filter(
    (p) => Number.isFinite(p.actual) && Number.isFinite(p.lo) && Number.isFinite(p.hi)
  );
  const hits = valid.reduce(
    (acc, p) => acc + (p.actual >= Math.min(p.lo, p.hi) && p.actual <= Math.max(p.lo, p.hi) ? 1 : 0),
    0
  );
  const coverage = valid.length ? (hits / valid.length) * 100 : null;

  const fs = compact ? 11.5 : 12.5;   // 통계 줄 글자 크기

  return (
    <div style={{
      background: "#fff", border: "1px solid var(--border)", borderRadius: 14,
      padding: compact ? "10px 12px 10px" : "16px 16px 14px", boxShadow: "var(--shadow)",
    }}>
      {/* 균열관리번호 + 현장명 (현장 선택 없이 카드마다 현장을 함께 표기) */}
      <div style={{ display: "flex", 
        justifyContent: "space-between",
        alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 7, background: "var(--badge-bg)",
          color: "var(--navy)", fontWeight: 600, fontSize: compact ? 12 : 13,
          padding: compact ? "4px 10px" : "5px 12px", borderRadius: 999, flexShrink: 0,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--orange)" }} />
          {label}
        </span>
        {site && (
          <span title={site} style={{
            fontSize: compact ? 11.5 : 12.5, color: "var(--muted)", minWidth: 0,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{site}</span>
        )}
      </div>

      <MiniChart points={points} compact={compact} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: compact ? 6 : 14 }}>
        <span style={{ fontSize: fs, color: "var(--muted)" }}>예측 오차 |예측−실측|</span>
        <span style={{ fontSize: fs, color: "var(--muted)" }}>
          {errMin != null && errMax != null
            ? `${errMin.toFixed(2)}–${errMax.toFixed(2)}mm`
            : "—"}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
        <span style={{ fontSize: fs, color: "var(--muted)" }}>
          {compact ? "예측 정확도 (95%)" : "예측 정확도 (95% 구간 적중률)"}
        </span>
        <span style={{ fontSize: fs, color: "var(--muted)" }}>
          {coverage != null ? `${coverage.toFixed(1)}%` : "—"}
        </span>
      </div>

      {/* 이 센서만 DB 저장 (표시 중인 기간의 예측값) */}
      {onSave && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: compact ? 8 : 12 }}>
          <button className="btn-save" onClick={onSave}
            disabled={saveState === "saving" || !points.length}
            style={{
              flex: 1, padding: compact ? "7px 10px" : "9px 14px", borderRadius: 9,
              fontSize: compact ? 12 : 13.5, fontWeight: 600,
              border: "1px solid var(--orange)",
              background: saveState === "done" ? "#fff" : "var(--orange)",
              color: saveState === "done" ? "var(--orange)" : "#fff",
              cursor: saveState === "saving" ? "wait" : (points.length ? "pointer" : "not-allowed"),
              opacity: !points.length ? 0.45 : 1,
            }}>
            {saveState === "saving" ? "저장 중…"
              : saveState === "done" ? "저장 완료 · 다시 저장"
              : "예측 데이터 DB 저장"}
          </button>
          {saveState === "empty" && (
            <span style={{ fontSize: fs, color: "#b3452f", whiteSpace: "nowrap" }}>저장할 값 없음</span>
          )}
        </div>
      )}
    </div>
  );
}

const C_ACTUAL = "#5a67b8"; // 실측 (파랑, --line)
const C_PRED = "#e11d48";   // 예측 · 우리 모델 (빨강)

function MiniChart({ points, compact = false }: { points: Point[]; compact?: boolean }) {
  const H = compact ? 132 : 220;   // 10개를 한 화면에 담기 위한 축소 높이
  const chartRef = useRef<ChartJS<"line"> | null>(null);
  if (!points.length) {
    return <div style={{ height: H, display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 13 }}>데이터 없음</div>;
  }

  const labels = points.map((p) => p.ds.slice(5, 10));

  const data = {
    labels,
    datasets: [
      // 95% 구간 상단 (lo까지 채워서 음영 표현)
      {
        label: "상한",
        data: points.map((p) => p.hi),
        borderColor: "transparent",
        backgroundColor: "rgba(236,106,52,.12)",
        pointRadius: 0,
        fill: "+1", // 다음 데이터셋(하한)까지 채움
        tension: 0.25,
      },
      {
        label: "하한",
        data: points.map((p) => p.lo),
        borderColor: "transparent",
        backgroundColor: "transparent",
        pointRadius: 0,
        fill: false,
        tension: 0.25,
      },
      // 3일 예측 (우리 모델 · 빨강 점선)
      {
        label: "아신씨엔티 모델",
        data: points.map((p) => p.pred),
        borderColor: C_PRED,
        borderWidth: 1.8,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointBackgroundColor: C_PRED,
        pointBorderColor: C_PRED,
        fill: false,
        tension: 0.25,
      },
      // 실측 (파란 실선)
      {
        label: "실제 측정 데이터",
        data: points.map((p) => p.actual),
        borderColor: C_ACTUAL,
        borderWidth: 1.8,
        pointRadius: (ctx: any) => (ctx.dataIndex === points.length - 1 ? 3.4 : 0),
        pointHoverRadius: 4,
        pointBackgroundColor: C_ACTUAL,
        pointBorderColor: C_ACTUAL,
        fill: false,
        tension: 0.25,
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    layout: { padding: { bottom: compact ? 0 : 40 } },
    plugins: {
      // 휠=확대/축소, 드래그=좌우 이동, 더블클릭=리셋 (x축 기준)
      zoom: {
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true },
          mode: "x",
        },
        pan: { enabled: true, mode: "x" },
        limits: { x: { minRange: 3 } },
      },
      legend: {
        // 압축 모드에선 카드마다 범례가 반복돼 자리만 차지 → 하단 안내문으로 대체
        display: !compact,
        position: "bottom",
        labels: {
          boxWidth: 18,
          boxHeight: 2,
          font: { size: 12 },
          color: "#20223c",
          // 음영(상한/하한) 데이터셋은 범례에서 숨김
          filter: (item) => item.text === "실제 측정 데이터" || item.text === "아신씨엔티 모델",
        },
      },
      tooltip: {
        filter: (item) => item.dataset.label === "실제 측정 데이터" || item.dataset.label === "아신씨엔티 모델",
        usePointStyle: true,
        // 툴팁을 점 아래로 고정 (점을 가리지 않게)
        position: "belowLowest" as any,
        yAlign: "top",
        caretPadding: 8,
        callbacks: {
          // 툴팁 제목 = 날짜 + 시각 (하루 안 2h 점들 구별용: "07-05 02시")
          title: (items) => {
            const i = items[0]?.dataIndex;
            if (i == null) return "";
            const ds = points[i]?.ds ?? "";
            const [date, time] = ds.split("T");
            const md = date ? date.slice(5) : "";
            const hh = time ? Number(time.slice(0, 2)) : "";
            return `${md} ${hh}시`;
          },
          // 툴팁 색상 박스를 선 색과 일치
          labelColor: (item) => {
            const c = item.dataset.label === "실제 측정 데이터" ? C_ACTUAL : C_PRED;
            return { borderColor: c, backgroundColor: c };
          },
          // 이 시점 LSTM이 생성한 커널 파라미터 Θ (실시간 조정 확인용)
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: "#a9a9b8",
          font: { size: 9, family: "monospace" },
          maxTicksLimit: 5,
          autoSkip: true,
          maxRotation: 0,
        },
      },
      y: {
        grid: { color: "#e4e4ec" },
        ticks: {
          color: "#a9a9b8",
          font: { size: 9, family: "monospace" },
          maxTicksLimit: 3,
          callback: (v) => Number(v).toFixed(1),
        },
      },
    },
  };

  return (
    <div
      style={{ height: H, marginTop: 10 }}
      onDoubleClick={() => chartRef.current?.resetZoom()}
      title="휠=확대/축소 · 드래그=이동 · 더블클릭=리셋"
    >
      <Line ref={chartRef} data={data} options={options} />
    </div>
  );
}
