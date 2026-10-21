import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Cookies } from "./session"

const redis = vi.hoisted(() => ({
  del: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}))

vi.mock("@/redis/redis", () => ({ redisClient: redis }))

import { createUserSession } from "./session"

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

    await createUserSession({ id: "user-42", sessionVersion: 0 }, cookies)

    expect(redis.del).toHaveBeenCalledWith("session:old-session-id")
    expect(redis.set).toHaveBeenCalledOnce()
    expect(cookies.get("session-id")?.value).not.toBe("old-session-id")
  })

  it("gives the stored session and cookie the same seven-day absolute expiration", async () => {
    const before = Date.now()
    const cookies = new CookieJar()

    await createUserSession({ id: "user-42", sessionVersion: 3 }, cookies)

    const [key, stored, options] = redis.set.mock.calls[0] ?? []
    expect(key).toBe(`session:${cookies.get("session-id")?.value}`)
    expect(stored).toEqual({
      id: "user-42",
      sessionVersion: 3,
      expiresAt: cookies.options.get("session-id")?.expires,
    })
    expect(options).toEqual({ ex: 60 * 60 * 24 * 7 })
    expect(stored.expiresAt).toBeGreaterThanOrEqual(before + 7 * 86_400_000)
  })
})
