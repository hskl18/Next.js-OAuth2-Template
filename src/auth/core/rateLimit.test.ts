import { describe, expect, it, vi } from "vitest"

vi.mock("@/redis/redis", () => ({ redisClient: {} }))

import { enforceAuthRateLimit } from "./rateLimit"

describe("authentication rate limiting", () => {
  it("fails closed with a bounded retry delay and does not expose raw identifiers", async () => {
    const limit = vi.fn().mockResolvedValue({
      success: false,
      limit: 5,
      remaining: 0,
      reset: Date.now() + 30_000,
      pending: Promise.resolve(),
    })

    await expect(
      enforceAuthRateLimit("sign-in", "person@example.com|192.0.2.10", {
        limit,
      })
    ).rejects.toMatchObject({
      name: "AuthRateLimitError",
      retryAfterSeconds: expect.any(Number),
    })
    expect(limit).toHaveBeenCalledOnce()
    expect(limit.mock.calls[0]?.[0]).not.toContain("person@example.com")
    expect(limit.mock.calls[0]?.[0]).not.toContain("192.0.2.10")
  })
})
