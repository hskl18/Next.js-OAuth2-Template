import { env } from "@/data/env/server"
import { drizzle } from "drizzle-orm/node-postgres"
import * as schema from "./schema"
import { Pool } from "pg"

export const dbPool = new Pool({
  password: env.DB_PASSWORD,
  user: env.DB_USER,
  database: env.DB_NAME,
  host: env.DB_HOST,
})

export const db = drizzle(dbPool, { schema })
