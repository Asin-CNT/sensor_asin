// 모델 로드 + 실시간 추론 (LSTM ONNX → Θ → JS GP → μ,σ)
import * as ort from "onnxruntime-web";
import { gpPredict, Config } from "./gp";

export type Sensor = { site: string; ds: string[]; value: number[]; mu: number; sd: number; cut: number };
export type Sensors = Record<string, Sensor>;
export type Point = { ds: string; actual: number; pred: number; lo: number; hi: number; theta: [number, number, number] };

let cfg: Config | null = null;
let sensors: Sensors | null = null;
let session: ort.InferenceSession | null = null;
let ready: Promise<void> | null = null;
const cache: Record<string, Point[]> = {};

export function initModel(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    // 단일 스레드 wasm (COOP/COEP 헤더 불필요). 버전 고정 CDN.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/";
    const [c, s] = await Promise.all([
      fetch("/model/config.json").then((r) => r.json()),
      fetch("/model/sensors.json").then((r) => r.json()),
    ]);
    cfg = c; sensors = s;
    session = await ort.InferenceSession.create("/model/lstm.onnx");
  })();
  return ready;
}

export function getSensors(): Sensors { return sensors ?? {}; }
export function getConfig(): Config | null { return cfg; }

// 한 센서의 test 기간 전체를 실시간 추론 → Point[]
export async function predictSensor(sid: string): Promise<Point[]> {
  if (cache[sid]) return cache[sid];
  await initModel();
  const d = sensors![sid], C = cfg!, W = C.W, H = C.H;
  const v = d.value, vn = v.map((x) => (x - d.mu) / d.sd);
  const targets: number[] = [];
  for (let j = d.cut; j < v.length; j++) { const k = j - W - H + 1; if (k >= 0) targets.push(j); }
  const N = targets.length;
  if (!N) return (cache[sid] = []);

  // 입력 채널: 1채널=[크랙], 3채널=[크랙, 위상sin, 위상cos]
  const inCh = C.in_ch ?? 1;
  // 하루 위상(시각) — sensors.json 타임스탬프에서 계산
  const hod = d.ds.map((s) => {
    const t = s.split("T")[1] || "00:00:00";
    const [hh, mm] = t.split(":");
    return Number(hh) + Number(mm) / 60;
  });
  const flat = new Float32Array(N * W * inCh);
  targets.forEach((j, idx) => {
    const k = j - W - H + 1;
    for (let w = 0; w < W; w++) {
      const p = k + w;
      const base = (idx * W + w) * inCh;
      flat[base] = vn[p];                       // ch0: 크랙(정규화)
      if (inCh >= 3) {
        const ph = (2 * Math.PI * hod[p]) / 24; // ch1,2: 하루 위상
        flat[base + 1] = Math.sin(ph);
        flat[base + 2] = Math.cos(ph);
      }
    }
  });
  const out = await session!.run({ window: new ort.Tensor("float32", flat, [N, W, inCh]) });
  const theta = out.theta.data as Float32Array;

  const pts: Point[] = targets.map((j, idx) => {
    const k = j - W - H + 1;
    const win = vn.slice(k, k + W);
    const anchor = vn[k + W - 1];
    const z = win.map((x) => x - win[W - 1]);
    const th: [number, number, number] = [theta[idx * 3], theta[idx * 3 + 1], theta[idx * 3 + 2]];
    const { mu, sigma } = gpPredict(z, th, C);
    const predMm = (mu + anchor) * d.sd + d.mu;
    const sigMm = sigma * d.sd;
    return { ds: d.ds[j], actual: v[j], pred: predMm, lo: predMm - 1.96 * sigMm, hi: predMm + 1.96 * sigMm, theta: th };
  });
  cache[sid] = pts;
  return pts;
}
