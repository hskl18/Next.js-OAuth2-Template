import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("@/redis/redis", () => ({ redisClient: {} }))

import { AuthRateLimitError, enforceAuthRateLimit } from "./rateLimit"

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

describe("authentication rate limiting when Redis misbehaves", () => {
  let hangingServer: Server
  let hangingUrl: string

  beforeAll(async () => {
    hangingServer = createServer(() => {
      // Never respond, like an overloaded Redis REST endpoint.
    })
    await new Promise<void>(resolve => hangingServer.listen(0, resolve))
    const { port } = hangingServer.address() as AddressInfo
    hangingUrl = `http://127.0.0.1:${port}`
  })

  afterAll(() => {
    hangingServer.closeAllConnections()
    hangingServer.close()
  })

  function limiterFor(url: string) {
    return new Ratelimit({
      redis: new Redis({ url, token: "test-token", retry: false }),
      limiter: Ratelimit.slidingWindow(10, "10 m"),
      analytics: false,
      timeout: 100,
    })
  }

  it("rejects when the real limiter times out instead of allowing the attempt", async () => {
    await expect(
      enforceAuthRateLimit("sign-in", "person@example.com", limiterFor(hangingUrl))
    ).rejects.toMatchObject({ name: "AuthRateLimitUnavailableError" })
  })

  it("rejects when Redis refuses the connection", async () => {
    const closed = createServer()
    await new Promise<void>(resolve => closed.listen(0, resolve))
    const { port } = closed.address() as AddressInfo
    await new Promise<void>(resolve => closed.close(() => resolve()))

    const error = await enforceAuthRateLimit(
      "sign-in",
      "person@example.com",
      limiterFor(`http://127.0.0.1:${port}`)
    ).catch((caught: unknown) => caught)

    // A transport error, not a timeout verdict; callers turn any rejection
    // into the generic authentication failure.
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(AuthRateLimitError)
  })
})
