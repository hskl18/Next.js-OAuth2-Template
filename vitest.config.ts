import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: {
      "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src"),
    },
  },
  test: {
    environment: "node",
    clearMocks: true,
    // Integration files reset the same PostgreSQL tables, so they run one at a time.
    fileParallelism: process.env.RUN_DB_INTEGRATION !== "1",
  },
})
