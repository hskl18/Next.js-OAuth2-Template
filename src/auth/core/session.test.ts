import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Cookies } from "./session"

const redis = vi.hoisted(() => ({
  del: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}))

vi.mock("@/redis/redis", () => ({ redisClient: redis }))

import { createUserSession, updateUserSessionExpiration } from "./session"

type CookieOptions = Parameters<Cookies["set"]>[2]

class CookieJar {
  private readonly values = new Map<string, string>()
  readonly options = new Map<string, CookieOptions>()

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value)
  }

  set(key: string, value: string, options: CookieOptions) {
    this.values.set(key, value)
    this.options.set(key, options)
  }

  get(key: string) {
    const value = this.values.get(key)
    return value == null ? undefined : { name: key, value }
  }
}

describe("session creation", () => {
  beforeEach(() => {
    redis.del.mockReset()
    redis.get.mockReset()
    redis.set.mockReset()
  })

  it("revokes an existing session before issuing a new login session", async () => {
    const cookies = new CookieJar({ "session-id": "old-session-id" })

    await createUserSession({ id: "user-42", role: "user" }, cookies)

    expect(redis.del).toHaveBeenCalledWith("session:old-session-id")
    expect(redis.set).toHaveBeenCalledOnce()
    expect(cookies.get("session-id")?.value).not.toBe("old-session-id")
  })

  it("does not extend a session beyond its original absolute expiration", async () => {
    const now = Date.now()
    const expiresAt = now + 60_000
    const cookies = new CookieJar({ "session-id": "current-session-id" })
    redis.get.mockResolvedValueOnce({
      id: "user-42",
      role: "user",
      expiresAt,
    })

    await updateUserSessionExpiration(cookies)

    expect(redis.set).toHaveBeenCalledWith(
      "session:current-session-id",
      { id: "user-42", role: "user", expiresAt },
      { ex: expect.any(Number) }
    )
    const ttl = redis.set.mock.calls[0]?.[2]?.ex
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(60)
    expect(cookies.options.get("session-id")?.expires).toBe(expiresAt)
  })
})
