/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // ONNX 세션 이중 로드 방지
  webpack: (config) => {
    // onnxruntime-web 이 참조하는 node 전용 모듈 무시 (브라우저 빌드)
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false };
    return config;
  },
};
module.exports = nextConfig;
