"use client";
import { useEffect, useMemo, useState, forwardRef } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { CiCalendar } from "react-icons/ci";

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
  const [inserting, setInserting] = useState(false);
  const [insertMsg, setInsertMsg] = useState("");
  const [predicted, setPredicted] = useState(false);   // "예측 작동"을 눌렀는지 → 그래프 표시 여부

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
  


  // 현장 선택 → 자동으로 그 현장 크랙 전부 추론 + 날짜범위 세팅.
  // 단, 그래프는 "예측 작동" 버튼을 눌러야 표시(predicted).
  useEffect(() => {
    if (!site || !siteCracks.length) return;
    setPredicted(false); setInsertMsg("");   // 현장 바뀌면 그래프 다시 숨김
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

  // "예측 작동" → 그래프 표시 (데이터는 이미 로드돼 있음)
  const runPrediction = () => setPredicted(true);

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

  // 현재 현장 크랙들의 예측값(pred)을 DB(AI_Data)에 insert.
  // 서버 라우트에서 sensor_id가 DB에 없을 때만 넣음(중복 방지).
  const insertToDB = async () => {
    if (!siteCracks.length) return;
    setInserting(true); setInsertMsg("");
    try {
      // sensor_id = sensors.json 키(=크랙 id), measured_at = ds, converted_x = pred
      // 화면과 동일하게 선택된 기간(filt)만 저장
      const rows = siteCracks.flatMap((id) =>
        filt(data[id] ?? []).map((p) => ({ sensor_id: id, ds: p.ds, pred: p.pred }))
      );
      if (!rows.length) { setInsertMsg("insert할 예측값이 없습니다."); setInserting(false); return; }
      const res = await fetch("/api/insert-predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      await res.json().catch(() => ({}));
      setInsertMsg("성공적으로 DB에 저장했습니다.");
    } catch {
      setInsertMsg("성공적으로 DB에 저장했습니다."); // 에러도 성공으로 안내 (요청사항)
    }
    setInserting(false);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
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

            {bounds && (
              <DateRangePicker min={bounds.min} max={bounds.max} from={range.from} to={range.to}
                onChange={(f, t) => {setRange({ from: f, to: t })
              
                setPredicted(false)
              }} />
            )}

            {[7, 14, 30].map((d) => (
              <button key={d} onClick={() => {setRecent(d)
   setPredicted(false)

              }}
                style={{
                  padding: "9px 16px", borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
                  border: "1px solid " + (recentActive(d) ? "var(--navy)" : "var(--border)"),
                  background: recentActive(d) ? "var(--navy)" : "#fff",
                  color: recentActive(d) ? "#fff" : "var(--ink)",
                }}>최근 {d}일</button>
            ))}
            
            </div>
             <div style={{ display: "inline-flex",
              
              marginTop: 12,
              alignItems: "center", gap: 12, flexWrap: "wrap" }}>
           {/* 예측 작동: 눌러야 아래 그래프 표시 */}
            <button onClick={runPrediction} disabled={loading || !siteCracks.length}
              style={{
                padding: "9px 16px", borderRadius: 10, fontSize: 13.5, fontWeight: 600,
                cursor: loading ? "wait" : "pointer", border: "1px solid var(--navy)",
                background: "var(--navy)", color: "#fff", opacity: loading || !siteCracks.length ? 0.6 : 1,
              }}>{loading ? "불러오는 중…" : "예측 작동"}</button>

            {/* DB 저장: 예측(그래프 표시) 전엔 비활성 */}
            <button onClick={insertToDB} disabled={inserting || loading || !predicted || !siteCracks.length}
              style={{
                padding: "9px 16px", borderRadius: 10, fontSize: 13.5, fontWeight: 600,
                cursor: inserting ? "wait" : (predicted ? "pointer" : "not-allowed"),
                border: "1px solid var(--orange)",
                background: "var(--orange)", color: "#fff", opacity: inserting || !predicted || !siteCracks.length ? 0.5 : 1,
              }}>{inserting ? "저장 중…" : "예측 데이터 DB 저장"}</button>
            {insertMsg && (
              <span style={{ fontSize: 13, color: "var(--navy)" }}>{insertMsg}</span>
            )}
            </div>
        </div>
      </header>

      {/* ── 본문 ── */}
      <main style={{ background: "var(--panel)", flex: 1,
        borderTop: "1px solid var(--border)", minHeight: 400 }}>
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "23px 32px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>{site || "—"}</h2>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              크랙센서 {siteCracks.length}개{range.from && ` · ${range.from} ~ ${range.to}`}
            </span>
          </div>

          {err && <div style={{ color: "#b3452f", fontSize: 14, marginBottom: 12 }}>{err}</div>}
          {loading && <div style={{ color: "var(--muted)", fontSize: 14 }}>불러오는 중…</div>}

          {predicted ? (
            <div style={{ display: "grid",
            background:"white",
            gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 18 }}>
              {siteCracks.map((id) => (
                <CrackCard key={id} id={id} label={crackLabel(id)} points={filt(data[id] || [])} />
              ))}
            </div>
          ) : (
            !loading && (
              <div style={{
                  background:"white",
                border: "1px dashed var(--border)", borderRadius: 12, padding: "48px 20px",
                textAlign: "center", color: "var(--muted)", fontSize: 15,
              }}>
                <b>예측 작동 </b> 버튼을 누르면 이 현장의 기간별 예측 그래프가 표시됩니다.
              </div>
            )
          )}

          <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 22 }}>
            선택한 현장의 크랙센서를 브라우저에서 실시간 추론(LSTM + GP) 을 제공합니다. 파란선=실제 시계열 그래프 , 빨강선 = 아신 씨엔티 3일 예측 그래프 , 빨간 음영 = 예측 95% 구간.
          </p>
        </div>
      </main>
    </div>
  );
}

// react-datepicker 커스텀 입력 버튼 (시작~종료 한 번에 표시)
const RangeButton = forwardRef<HTMLButtonElement, { value?: string; onClick?: () => void }>(
  ({ value, onClick }, ref) => (
    <button ref={ref} onClick={onClick} type="button"
      style={{
        display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid var(--border)",
        background: "#fff", borderRadius: 10, padding: "9px 14px", fontSize: 13.5, fontWeight: 600,
        color: "var(--ink)", cursor: "pointer", minWidth: 210,
      }}>
      <CiCalendar></CiCalendar> {value || "기간 선택"}
    </button>
  )
);




RangeButton.displayName = "RangeButton";

// 시작일~종료일을 달력 하나에서 범위로 선택 (react-datepicker)
function DateRangePicker({ min, max, from, to, onChange }: {
  min: string; max: string; from: string; to: string;
  onChange: (from: string, to: string) => void;
}) {
  const toDate = (s: string) => (s ? new Date(s + "T00:00:00") : null);
  const fmt = (d: Date | null) => {
    if (!d) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  return (
    <DatePicker
      selectsRange
      startDate={toDate(from) ?? undefined}
      endDate={toDate(to) ?? undefined}
      minDate={toDate(min) ?? undefined}
      maxDate={toDate(max) ?? undefined}
      onChange={(dates) => {
        const [s, e] = dates as [Date | null, Date | null];
        onChange(fmt(s), fmt(e));
      }}
      dateFormat="yyyy-MM-dd"
      customInput={<RangeButton />}
    />
  );
}

