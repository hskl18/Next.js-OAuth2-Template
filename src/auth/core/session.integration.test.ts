import { describe, expect, it } from "vitest"
import type { Cookies } from "./session"

const describeWithRedis =
  process.env.RUN_REDIS_INTEGRATION === "1" ? describe : describe.skip

class CookieJar implements Cookies {
  private readonly values = new Map<string, string>()

  set(key: string, value: string) {
    this.values.set(key, value)
  }

  get(key: string) {
    const value = this.values.get(key)
    return value == null ? undefined : { name: key, value }
  }

  delete(key: string) {
    this.values.delete(key)
  }
}

describeWithRedis("Redis session storage", () => {
  it("round-trips a session with a seven-day TTL and deletes it on logout", async () => {
    const { redisClient } = await import("@/redis/redis")
    const session = await import("./session")
    const cookies = new CookieJar()

    await session.createUserSession({ id: "user-42", sessionVersion: 3 }, cookies)
    const sessionId = cookies.get("session-id")?.value

    await expect(session.getUserFromSession(cookies)).resolves.toMatchObject({
      id: "user-42",
      sessionVersion: 3,
    })
    const ttl = await redisClient.ttl(`session:${sessionId}`)
    expect(ttl).toBeGreaterThan(60 * 60 * 24 * 7 - 60)
    expect(ttl).toBeLessThanOrEqual(60 * 60 * 24 * 7)

    await session.removeUserFromSession(cookies)
    expect(cookies.get("session-id")).toBeUndefined()
    expect(await redisClient.exists(`session:${sessionId}`)).toBe(0)
  })

  it("deletes the previous session when a login rotates the identifier", async () => {
    const { redisClient } = await import("@/redis/redis")
    const session = await import("./session")
    const cookies = new CookieJar()

    await session.createUserSession({ id: "user-42", sessionVersion: 0 }, cookies)
    const firstId = cookies.get("session-id")?.value
    await session.createUserSession({ id: "user-42", sessionVersion: 0 }, cookies)
    const secondId = cookies.get("session-id")?.value

    expect(secondId).not.toBe(firstId)
    expect(await redisClient.exists(`session:${firstId}`)).toBe(0)
    expect(await redisClient.exists(`session:${secondId}`)).toBe(1)
  })

  it("rejects a stored session from before session versions existed", async () => {
    const { redisClient } = await import("@/redis/redis")
    const session = await import("./session")
    const cookies = new CookieJar()
    cookies.set("session-id", "legacy-role-session")
    await redisClient.set(
      "session:legacy-role-session",
      { id: "user-42", role: "admin", expiresAt: Date.now() + 60_000 },
      { ex: 60 }
    )

    await expect(session.getUserFromSession(cookies)).resolves.toBeNull()
  })
})
