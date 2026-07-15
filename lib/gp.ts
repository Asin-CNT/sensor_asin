// GP 추론 (PyTorch cv_sites.py 의 kernel + DKR.forward 를 JS로 이식, 수치 일치 검증됨)
export type Config = {
  W: number; H: number; step_days: number; noise: number; jitter: number;
  t_grid: number[]; t_star: number; th_min: number; th_max: number; kind: string;
  in_ch?: number; channels?: string[];
};

function kMat(t: number[], a: number, b: number, c: number) {
  const n = t.length, K: number[][] = [];
  for (let i = 0; i < n; i++) { K[i] = new Array(n);
    for (let j = 0; j < n; j++) {
      const D = Math.abs(t[i] - t[j]);
      K[i][j] = Math.exp(-2 * Math.sin(Math.PI * D / a) ** 2 / (b * b) - (D * D) / (2 * c * c));
    }
  }
  return K;
}
function kVec(t: number[], ts: number, a: number, b: number, c: number) {
  return t.map((ti) => {
    const D = Math.abs(ts - ti);
    return Math.exp(-2 * Math.sin(Math.PI * D / a) ** 2 / (b * b) - (D * D) / (2 * c * c));
  });
}
function chol(K: number[][]) {
  const n = K.length, L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = 0; for (let k = 0; k < j; k++) s += L[i][k] * L[j][k];
    L[i][j] = i === j ? Math.sqrt(Math.max(K[i][i] - s, 1e-12)) : (K[i][j] - s) / L[j][j];
  }
  return L;
}
function cholSolve(L: number[][], b: number[]) {
  const n = L.length, y = new Array(n), x = new Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
  return x;
}

export function gpPredict(zCentered: number[], theta: number[], cfg: Config) {
  const a = Math.min(Math.max(theta[0], cfg.th_min), cfg.th_max);
  const b = Math.min(Math.max(theta[1], cfg.th_min), cfg.th_max);
  const c = Math.min(Math.max(theta[2], cfg.th_min), cfg.th_max);
  const t = cfg.t_grid, n = t.length;
  const K = kMat(t, a, b, c);
  for (let i = 0; i < n; i++) K[i][i] += cfg.noise + cfg.jitter;
  const ks = kVec(t, cfg.t_star, a, b, c);
  const L = chol(K), av = cholSolve(L, zCentered), vv = cholSolve(L, ks);
  let mu = 0, kv = 0;
  for (let i = 0; i < n; i++) { mu += ks[i] * av[i]; kv += ks[i] * vv[i]; }
  return { mu, sigma: Math.sqrt(Math.max(1 - kv + cfg.noise, 1e-6)) };
}
