import crypto from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const describeWithRedis =
  process.env.RUN_REDIS_INTEGRATION === "1" ? describe : describe.skip

describeWithRedis("Redis authentication rate limits", () => {
  beforeEach(() => {
    // Pin the clock mid-hour so a sliding-window bucket boundary cannot fall
    // between attempts; network timers stay real.
    const hour = 60 * 60 * 1000
    vi.spyOn(Date, "now").mockReturnValue(
      Math.floor(Date.now() / hour) * hour + hour / 2
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("blocks the sixth sign-up attempt in an hour and stores only hashed keys", async () => {
    const { redisClient } = await import("@/redis/redis")
    const { enforceAuthRateLimit } = await import("./rateLimit")
    // Unique per run so a reused local Redis does not carry earlier attempts.
    const email = `${crypto.randomUUID()}@example.com`
    const identifier = `unknown-client:${email}`

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await enforceAuthRateLimit("sign-up", identifier)
    }
    // Half of the one-hour window remains at the pinned time.
    await expect(
      enforceAuthRateLimit("sign-up", identifier)
    ).rejects.toMatchObject({
      name: "AuthRateLimitError",
      retryAfterSeconds: 30 * 60,
    })

    const keys = await redisClient.keys("auth-rate-limit:sign-up:*")
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.some(key => key.includes(email))).toBe(false)
  })

  it("keeps separate budgets per scope", async () => {
    const { enforceAuthRateLimit } = await import("./rateLimit")
    const identifier = `unknown-client:${crypto.randomUUID()}@example.com`

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await enforceAuthRateLimit("sign-up", identifier)
    }
    await expect(enforceAuthRateLimit("sign-up", identifier)).rejects.toThrow()
    await expect(
      enforceAuthRateLimit("sign-in", identifier)
    ).resolves.toBeUndefined()
  })
})
