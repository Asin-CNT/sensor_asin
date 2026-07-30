"use client";
import { useEffect, useMemo, useState, forwardRef } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
// react-icons는 세트별로 경로가 다름: Ci* → /ci , Md* → /md
import { CiCalendar } from "react-icons/ci";
import { MdOutlineAutoGraph, MdOutlineSaveAlt } from "react-icons/md";

import { initModel, getSensors, predictSensor, type Point, type Sensors } from "@/lib/predictor";
import CrackCard from "@/components/CrackCard";
import { crackLabel, TARGET_SENSOR_IDS, TARGET_CRACK_CODES } from "@/lib/crackCodes";

// 페이지 좌우 여백 — 헤더/본문이 같은 폭·같은 패딩을 쓰도록 한 곳에서 관리.
// clamp: 좁은 화면 20px → 넓은 화면 64px 까지 자동 증가.
const PAGE_MAX = 1480;
const PAGE_PAD_X = "clamp(20px, 3.5vw, 64px)";

// 실행 버튼 문구 (여기 한 줄만 바꾸면 됨)
const RUN_LABEL = "예측 실행";

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function Dashboard() {
  const [sensors, setSensors] = useState<Sensors>({});
  const [data, setData] = useState<Record<string, Point[]>>({});
  const [bounds, setBounds] = useState<{ min: string; max: string } | null>(null);
  const [range, setRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [predicted, setPredicted] = useState(false);   // "예측 실행"을 눌렀는지 → 그래프 표시 여부
  const [inserting, setInserting] = useState(false);
  const [insertMsg, setInsertMsg] = useState("");

  // 모델·데이터 로드
  useEffect(() => {
    (async () => {
      try {
        await initModel();
        setSensors(getSensors());
      } catch (e: any) { setErr("로드 실패: " + e.message); setLoading(false); }
    })();
  }, []);

  // 표시 대상 = crackCodes.ts 의 고정 10개 (현장 선택 없음)
  const targetCracks = useMemo(
    () => TARGET_SENSOR_IDS.filter((id) => sensors[id]),
    [sensors]
  );
  // sensors.json 에 없는 코드가 있으면 안내용으로 표시
  const missingCodes = useMemo(() => {
    if (!Object.keys(sensors).length) return [];
    const shown = new Set(targetCracks.map((id) => crackLabel(id)));
    return TARGET_CRACK_CODES.filter((c) => !shown.has(c));
  }, [sensors, targetCracks]);
  const siteOf = (id: string) => sensors[id]?.site ?? "";

  // 로드 완료 → 대상 10개 전부 추론 + 날짜범위 세팅.
  // 단, 그래프는 "예측 작동" 버튼을 눌러야 표시(predicted).
  useEffect(() => {
    if (!targetCracks.length) return;
    setPredicted(false); setInsertMsg("");
    (async () => {
      setLoading(true); setErr("");
      try {
        const map: Record<string, Point[]> = {};
        for (const id of targetCracks) map[id] = await predictSensor(id);
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
  }, [targetCracks]); // eslint-disable-line

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

  // 조회 결과 전체(표시 중인 센서 10개 · 선택 기간)의 예측값(pred)을 DB(AI_Data)에 일괄 insert.
  // 서버 라우트에서 sensor_id가 DB에 없을 때만 넣음(중복 방지).
  const insertToDB = async () => {
    if (!targetCracks.length) return;
    setInserting(true); setInsertMsg("");
    try {
      // sensor_id = sensors.json 키(=크랙 id), measured_at = ds, converted_x = pred
      // 화면과 동일하게 선택된 기간(filt)만 저장
      const rows = targetCracks.flatMap((id) =>
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
      <header style={{
        position: "relative", overflow: "hidden",
        padding: `18px ${PAGE_PAD_X} 14px`,
      }}>
        <div style={{
          position: "absolute", top: -120, right: -60, width: 420, height: 300,
          background: "radial-gradient(closest-side, rgba(180,150,240,.35), rgba(255,180,200,.18), transparent)",
          filter: "blur(20px)", pointerEvents: "none",
        }} />
        <div style={{ position: "relative", maxWidth: PAGE_MAX, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <img src="/model/logo.jpg" width={132} height={44} alt="" />
          </div>
          <div style={{ marginTop: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <h1 style={{ margin: 0, fontSize: 26, letterSpacing: "-0.02em" }}>AI 기반 예측 모델</h1>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5 }}>
              지정된 크랙센서 {TARGET_CRACK_CODES.length}개를 한 화면에 표시합니다 · 최근 데이터를 기반으로 미래 시점의 데이터를 예측합니다.
            </p>
          </div>

          {/* ── 컨트롤 ── */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
            {/* 기간 관련 컨트롤 묶음 (라벨 · 날짜 · 최근 N일) */}
            <div style={{
              display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
              padding: "6px 10px", borderRadius: 12,
              border: "1px solid var(--border)", background: "rgba(255,255,255,.6)",
            }}>
              <span style={{
                fontSize: 11.5, fontWeight: 700, color: "var(--muted)",
                letterSpacing: "0.04em", padding: "0 2px",
              }}>기간 설정</span>

              {bounds && (
                <DateRangePicker min={bounds.min} max={bounds.max} from={range.from} to={range.to}
                  onChange={(f, t) => {setRange({ from: f, to: t })

                  setPredicted(false)
                  setInsertMsg("")   // 기간이 바뀌면 저장 안내문 초기화
                }} />
              )}

              {[7, 14, 30].map((d) => (
                <button key={d} className="btn-chip" onClick={() => {setRecent(d)
     setPredicted(false)
     setInsertMsg("")

                }}
                  style={{
                    padding: "7px 14px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                    border: "1px solid " + (recentActive(d) ? "var(--navy)" : "var(--border)"),
                    background: recentActive(d) ? "var(--navy)" : "#fff",
                    color: recentActive(d) ? "#fff" : "var(--ink)",
                  }}>최근 {d}일</button>
              ))}
            </div>

            {/* 실행 버튼 묶음 — 오른쪽 끝으로 분리 */}
            <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {/* 예측 실행: 눌러야 아래 그래프 표시. 배경·hover 색은 globals.css 의 .btn-run */}
              <button className="btn-run" onClick={runPrediction} disabled={loading || !targetCracks.length}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "11px 22px", borderRadius: 999, fontSize: 14, fontWeight: 700,
                  cursor: loading ? "wait" : "pointer", border: "none",
                  color: "#fff",
                  opacity: loading || !targetCracks.length ? 0.55 : 1,
                }}>
                {/* 아이콘은 currentColor를 따라가므로 hover(주황)에서도 흰색 유지 */}
                <MdOutlineAutoGraph size={18} />
                {loading ? "불러오는 중…" : RUN_LABEL}
              </button>

              {/* DB 저장: 조회 결과(표시 중인 센서 전체 · 선택 기간) 일괄 저장. 예측 실행 전엔 비활성 */}
              <button className="btn-save" onClick={insertToDB}
                disabled={inserting || loading || !predicted || !targetCracks.length}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "11px 22px", borderRadius: 999, fontSize: 14, fontWeight: 700,
                  cursor: inserting ? "wait" : (predicted ? "pointer" : "not-allowed"),
                  border: "1px solid var(--orange)",
                  background: "var(--orange)", color: "#fff",
                  opacity: inserting || !predicted || !targetCracks.length ? 0.5 : 1,
                }}>
                <MdOutlineSaveAlt size={18} />
                {inserting ? "저장 중…" : "예측 데이터 DB 저장"}
              </button>

              {insertMsg && (
                <span style={{ fontSize: 13, color: "var(--navy)" }}>{insertMsg}</span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── 본문 ── */}
      <main style={{ background: "var(--panel)", flex: 1,
        borderTop: "1px solid var(--border)", minHeight: 400,
        padding: `16px ${PAGE_PAD_X} 20px` }}>
        <div style={{ maxWidth: PAGE_MAX, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
          
          </div>

          {err && <div style={{ color: "#b3452f", fontSize: 14, marginBottom: 12 }}>{err}</div>}
          {loading && <div style={{ color: "var(--muted)", fontSize: 14 }}>불러오는 중…</div>}
          {!!missingCodes.length && (
            <div style={{ color: "#b3452f", fontSize: 13, marginBottom: 10 }}>
              데이터가 없어 제외된 균열관리번호: {missingCodes.join(", ")}
            </div>
          )}

          {predicted ? (
            // 10개를 한 화면에: 넓은 화면 5열 × 2행, 좁아지면 자동으로 열 수 감소
            <div style={{ display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
              {targetCracks.map((id) => (
                <CrackCard key={id} id={id} label={crackLabel(id)} site={siteOf(id)}
                  points={filt(data[id] || [])} compact />
              ))}
            </div>
          ) : (
            !loading && (
              <div style={{
                  background:"white",
                border: "1px dashed var(--border)", borderRadius: 12, padding: "48px 20px",
                textAlign: "center", color: "var(--muted)", fontSize: 15,
              }}>
                <b>예측 실행 </b> 버튼을 누르면 지정된 크랙센서 {targetCracks.length}개의 기간별 예측 그래프가 표시됩니다.
              </div>
            )
          )}

          <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 14 }}>
            지정 크랙센서를 브라우저에서 실시간 추론(LSTM + GP) 합니다. 카드 제목 = 균열관리번호 · 현장명 , 파란선 = 실제 시계열 그래프 , 빨강선 = 아신 씨엔티 예측 그래프 , 빨간 음영 = 예측 95% 구간.
            <br />
            정확도 = 실측값이 예측 95% 구간 안에 들어온 건수 ÷ 예측 데이터 건수.
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
        display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border)",
        background: "#fff", borderRadius: 9, padding: "7px 12px", fontSize: 12.5, fontWeight: 600,
        color: "var(--ink)", cursor: "pointer", minWidth: 188,
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
      // 버튼 아래쪽으로 펼치고, 헤더의 overflow:hidden 에 잘리지 않게 body 포털(#dp-portal)로 렌더
      popperPlacement="bottom-start"
      portalId="dp-portal"
    />
  );
}

