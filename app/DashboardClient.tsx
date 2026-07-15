"use client";
import { useEffect, useMemo, useState } from "react";
import { initModel, getSensors, predictSensor, type Point, type Sensors } from "@/lib/predictor";
import CrackCard from "@/components/CrackCard";
import { crackLabel } from "@/lib/crackCodes";

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function Dashboard() {
  const [sensors, setSensors] = useState<Sensors>({});
  const [site, setSite] = useState("");
  const [data, setData] = useState<Record<string, Point[]>>({});
  const [bounds, setBounds] = useState<{ min: string; max: string } | null>(null);
  const [range, setRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // 모델·데이터 로드
  useEffect(() => {
    (async () => {
      try {
        await initModel();
        const s = getSensors(); setSensors(s);
        setSite((Object.values(s)[0] as any).site);
      } catch (e: any) { setErr("로드 실패: " + e.message); setLoading(false); }
    })();
  }, []);

  const siteList = useMemo(() => Array.from(new Set(Object.values(sensors).map((s) => s.site))), [sensors]);
  const siteCracks = useMemo(
    () => Object.entries(sensors).filter(([, s]) => s.site === site).map(([id]) => id),
    [sensors, site]
  );
  

 

  // 현장 선택 → 그 현장 크랙 전부 실시간 추론
  useEffect(() => {
    if (!site || !siteCracks.length) return;
    (async () => {
      setLoading(true); setErr("");
      try {
        const map: Record<string, Point[]> = {};
        for (const id of siteCracks) map[id] = await predictSensor(id);
        setData(map);
        const allDs = Object.values(map).flat().map((p) => p.ds.slice(0, 10)).sort();
        if (allDs.length) {
          const min = allDs[0], max = allDs[allDs.length - 1];
          setBounds({ min, max });
          const from = [addDays(max, -13), min].sort()[1]; // 최근 14일 (min 미만으로 안 감)
          setRange({ from, to: max });
        }
      } catch (e: any) { setErr("추론 실패: " + e.message); }
      setLoading(false);
    })();
  }, [site]); // eslint-disable-line

  const filt = (pts: Point[]) => pts.filter((p) => {
    const d = p.ds.slice(0, 10);
    return (!range.from || d >= range.from) && (!range.to || d <= range.to);
  });
  const setRecent = (days: number) => {
    if (!bounds) return;
    setRange({ from: [addDays(bounds.max, -(days - 1)), bounds.min].sort()[1], to: bounds.max });
  };
  const recentActive = (days: number) =>
    !!bounds && range.to === bounds.max && range.from === [addDays(bounds.max, -(days - 1)), bounds.min].sort()[1];

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* ── 헤더 ── */}
      <header style={{ position: "relative", overflow: "hidden", padding: "34px 32px" }}>
        <div style={{
          position: "absolute", top: -120, right: -60, width: 420, height: 300,
          background: "radial-gradient(closest-side, rgba(180,150,240,.35), rgba(255,180,200,.18), transparent)",
          filter: "blur(20px)", pointerEvents: "none",
        }} />
        <div style={{ position: "relative", maxWidth: 1160, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <img src="/model/logo.jpg" width={150} height={50} alt="" />
          </div>
          <h1 style={{ margin: "0 0 8px", fontSize: 34, letterSpacing: "-0.02em" }}>AI 기반 3일 추세 예측 모델</h1>
          <p style={{ margin: "10px 0", color: "var(--muted)", fontSize: 15 }}>
            현장과 기간을 선택하면 해당 크랙센서 그래프가 실시간으로 기간에 맞춰 반영됩니다.
          </p>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 15 }}>

최근 3일 데이터(2시간 간격)를 기반으로 3일 후 시점의 데이터를 예측합니다.

          </p>

          {/* ── 컨트롤 ── */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 20 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8, background: "var(--navy)",
              color: "#fff", padding: "4px 6px 4px 14px", borderRadius: 10, fontSize: 14,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--orange)" }} />
              <span style={{ opacity: 0.85, fontSize: 13 }}>현장</span>
              <select value={site} onChange={(e) => setSite(e.target.value)}
                style={{ background: "transparent", color: "#fff", border: "none", fontWeight: 600, fontSize: 14, padding: "6px 4px", cursor: "pointer" }}>
                {siteList.map((nm) => <option key={nm} value={nm} style={{ color: "#222" }}>{nm}</option>)}
              </select>
            </div>

            <DateField label="시작일" value={range.from} min={bounds?.min} max={bounds?.max}
              onChange={(v) => setRange((r) => ({ ...r, from: v }))} />
            <span style={{ color: "var(--muted)" }}>→</span>
            <DateField label="종료일" value={range.to} min={bounds?.min} max={bounds?.max}
              onChange={(v) => setRange((r) => ({ ...r, to: v }))} />

            {[7, 14, 30].map((d) => (
              <button key={d} onClick={() => setRecent(d)}
                style={{
                  padding: "9px 16px", borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
                  border: "1px solid " + (recentActive(d) ? "var(--navy)" : "var(--border)"),
                  background: recentActive(d) ? "var(--navy)" : "#fff",
                  color: recentActive(d) ? "#fff" : "var(--ink)",
                }}>최근 {d}일</button>
            ))}
          </div>
        </div>
      </header>

      {/* ── 본문 ── */}
      <main style={{ background: "var(--panel)", borderTop: "1px solid var(--border)", minHeight: 400 }}>
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "26px 32px 60px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>{site || "—"}</h2>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              크랙센서 {siteCracks.length}개{range.from && ` · ${range.from} ~ ${range.to}`}
            </span>
          </div>

          {err && <div style={{ color: "#b3452f", fontSize: 14, marginBottom: 12 }}>{err}</div>}
          {loading && <div style={{ color: "var(--muted)", fontSize: 14 }}>불러오는 중…</div>}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 18 }}>
            {siteCracks.map((id) => {
              const s = sensors[id];
              const vals = s.value;
              const rng: [number, number] = [Math.min(...vals), Math.max(...vals)];
              return (
                <CrackCard key={id} id={id} label={crackLabel(id)} 
                  points={filt(data[id] || [])} />
              );
            })}
          </div>

          <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 22 }}>
            선택한 현장의 크랙센서를 브라우저에서 실시간 추론(LSTM ONNX + GP)합니다. 파란선=실측, 주황 점선=3일 예측, 음영=95% 구간.
          </p>
        </div>
      </main>
    </div>
  );
}

function DateField({ label, value, min, max, onChange }: {
  label: string; value: string; min?: string; max?: string; onChange: (v: string) => void;
}) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid var(--border)",
      background: "#fff", borderRadius: 10, padding: "6px 12px", fontSize: 14,
    }}>
      <span style={{ color: "var(--muted)", fontSize: 13 }}>{label}</span>
      <input type="date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)}
        style={{ border: "none", fontSize: 14, outline: "none", color: "var(--ink)" }} />
    </div>
  );
}

