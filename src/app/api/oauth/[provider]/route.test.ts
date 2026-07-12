import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  cookieStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  clearAuthAttempt: vi.fn(),
  createUserSession: vi.fn(),
  discardAuthAttempt: vi.fn(),
  enforceAuthRateLimit: vi.fn(),
  fetchUser: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url })
  }),
  resolveOAuthLogin: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: async () => mocks.cookieStore,
}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/auth/core/oauth/base", () => ({
  getOAuthClient: () => ({
    clearAuthAttempt: mocks.clearAuthAttempt,
    discardAuthAttempt: mocks.discardAuthAttempt,
    fetchUser: mocks.fetchUser,
  }),
}))
vi.mock("@/auth/core/oauth/account", () => ({
  resolveOAuthLogin: mocks.resolveOAuthLogin,
}))
vi.mock("@/auth/core/oauth/postgresAccountStore", () => ({
  oauthAccountStore: {},
}))
vi.mock("@/auth/core/session", () => ({
  createUserSession: mocks.createUserSession,
}))
vi.mock("@/auth/core/rateLimit", () => ({
  enforceAuthRateLimit: mocks.enforceAuthRateLimit,
}))

import { GET } from "./route"

const validState = "a".repeat(128)

describe("OAuth callback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("consumes the one-time attempt when the provider denies authorization", async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/oauth/github?error=access_denied&state=${validState}`
    )

    await expect(
      GET(request, { params: Promise.resolve({ provider: "github" }) })
    ).rejects.toMatchObject({
      url: "/sign-in?oauthError=Failed%20to%20connect.%20Please%20try%20again.",
    })
    expect(mocks.discardAuthAttempt).toHaveBeenCalledWith(
      validState,
      mocks.cookieStore
    )
    expect(mocks.fetchUser).not.toHaveBeenCalled()
  })

  it("rejects an unknown provider with the same generic public error", async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/oauth/unknown?code=code&state=${validState}`
    )

    await expect(
      GET(request, { params: Promise.resolve({ provider: "unknown" }) })
    ).rejects.toMatchObject({
      url: "/sign-in?oauthError=Failed%20to%20connect.%20Please%20try%20again.",
    })
    expect(mocks.fetchUser).not.toHaveBeenCalled()
  })

  it("ignores attacker-controlled redirect parameters after login", async () => {
    mocks.fetchUser.mockResolvedValueOnce({
      id: "provider-user-42",
      email: "person@example.com",
      name: "Example Person",
    })
    mocks.resolveOAuthLogin.mockResolvedValueOnce({
      id: "local-user-42",
      role: "user",
    })
    const request = new NextRequest(
      `http://localhost:3000/api/oauth/github?code=code&state=${validState}&next=https://attacker.example`
    )

    await expect(
      GET(request, { params: Promise.resolve({ provider: "github" }) })
    ).rejects.toMatchObject({ url: "/" })
    expect(mocks.createUserSession).toHaveBeenCalledOnce()
  })

  it("clears the attempt when the callback rate limit fails", async () => {
    mocks.enforceAuthRateLimit.mockRejectedValueOnce(new Error("limited"))
    const request = new NextRequest(
      `http://localhost:3000/api/oauth/github?code=code&state=${validState}`
    )

    await expect(
      GET(request, { params: Promise.resolve({ provider: "github" }) })
    ).rejects.toMatchObject({
      url: "/sign-in?oauthError=Failed%20to%20connect.%20Please%20try%20again.",
    })
    expect(mocks.clearAuthAttempt).toHaveBeenCalledWith(mocks.cookieStore)
    expect(mocks.fetchUser).not.toHaveBeenCalled()
  })
})
