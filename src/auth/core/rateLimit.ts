import crypto from "node:crypto"
import { Ratelimit } from "@upstash/ratelimit"
import { redisClient } from "@/redis/redis"

export type AuthRateLimitScope =
  | "sign-in"
  | "sign-up"
  | "oauth-start"
  | "oauth-callback"

type Limiter = {
  limit(identifier: string): Promise<{
    success: boolean
    reset: number
  }>
}

const limiters: Record<AuthRateLimitScope, Limiter> = {
  "sign-in": createLimiter("sign-in", 10, "10 m"),
  "sign-up": createLimiter("sign-up", 5, "1 h"),
  "oauth-start": createLimiter("oauth-start", 20, "10 m"),
  "oauth-callback": createLimiter("oauth-callback", 30, "10 m"),
}

export async function enforceAuthRateLimit(
  scope: AuthRateLimitScope,
  rawIdentifier: string,
  limiter: Limiter = limiters[scope]
) {
  const identifier = crypto
    .createHash("sha256")
    .update(`${scope}:${rawIdentifier}`)
    .digest("hex")
  const result = await limiter.limit(identifier)
  if (!result.success) {
    const retryAfterSeconds = Math.max(
      1,
      Math.min(3_600, Math.ceil((result.reset - Date.now()) / 1_000))
    )
    throw new AuthRateLimitError(retryAfterSeconds)
  }
}

export class AuthRateLimitError extends Error {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super("Authentication request rate limit exceeded")
    this.name = "AuthRateLimitError"
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function createLimiter(
  scope: AuthRateLimitScope,
  tokens: number,
  window: Parameters<typeof Ratelimit.slidingWindow>[1]
) {
  return new Ratelimit({
    redis: redisClient,
    limiter: Ratelimit.slidingWindow(tokens, window),
    analytics: false,
    prefix: `auth-rate-limit:${scope}`,
  })
}
