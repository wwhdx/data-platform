import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/integration/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "src/__tests__/integration/api/**"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: { DATA_PLATFORM_RATE_LIMIT_SCALE: "0.001" },
  },
});
