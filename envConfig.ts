import { loadEnvConfig } from "@next/env"

// Lets tools outside the Next.js runtime, such as drizzle-kit, read .env.local.
loadEnvConfig(process.cwd())
