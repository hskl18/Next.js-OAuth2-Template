import { z } from "zod"
import crypto from "crypto"
import { redisClient } from "@/redis/redis"

// Seven days in seconds
const SESSION_EXPIRATION_SECONDS = 60 * 60 * 24 * 7
const COOKIE_SESSION_KEY = "session-id"

const sessionSchema = z.object({
  id: z.string(),
  sessionVersion: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
})

type StoredSession = z.infer<typeof sessionSchema>
type UserSession = Pick<StoredSession, "id" | "sessionVersion">
export type Cookies = {
  set: (
    key: string,
    value: string,
    options: {
      secure?: boolean
      httpOnly?: boolean
      sameSite?: "strict" | "lax"
      expires?: number
      path?: string
    }
  ) => void
  get: (key: string) => { name: string; value: string } | undefined
  delete: (key: string) => void
}

export function getUserFromSession(cookies: Pick<Cookies, "get">) {
  const sessionId = cookies.get(COOKIE_SESSION_KEY)?.value
  if (sessionId == null) return null

  return getUserSessionById(sessionId)
}

export async function createUserSession(
  user: UserSession,
  cookies: Pick<Cookies, "get" | "set">
) {
  const existingSessionId = cookies.get(COOKIE_SESSION_KEY)?.value
  if (existingSessionId != null) {
    await redisClient.del(`session:${existingSessionId}`)
  }

  const sessionId = crypto.randomBytes(32).toString("hex").normalize()
  const expiresAt = Date.now() + SESSION_EXPIRATION_SECONDS * 1000
  const session = sessionSchema.parse({ ...user, expiresAt })
  await redisClient.set(`session:${sessionId}`, session, {
    ex: SESSION_EXPIRATION_SECONDS,
  })

  setCookie(sessionId, expiresAt, cookies)
}

export async function removeUserFromSession(
  cookies: Pick<Cookies, "get" | "delete">
) {
  const sessionId = cookies.get(COOKIE_SESSION_KEY)?.value
  if (sessionId == null) return null

  await redisClient.del(`session:${sessionId}`)
  cookies.delete(COOKIE_SESSION_KEY)
}

function setCookie(
  sessionId: string,
  expiresAt: number,
  cookies: Pick<Cookies, "set">
) {
  cookies.set(COOKIE_SESSION_KEY, sessionId, {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  })
}

async function getUserSessionById(sessionId: string) {
  const rawUser = await redisClient.get(`session:${sessionId}`)

  const { success, data: user } = sessionSchema.safeParse(rawUser)

  if (!success) return null
  if (user.expiresAt <= Date.now()) {
    await redisClient.del(`session:${sessionId}`)
    return null
  }
  return user
}
