import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      // 单测加速：连接器/目录采集的限速等待按比例缩放（实时行为单测可自设 "1"）
      DATA_PLATFORM_RATE_LIMIT_SCALE: "0.001",
    },
  },
});
