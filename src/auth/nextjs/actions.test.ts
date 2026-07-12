import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createUserSession: vi.fn(),
  enforceAuthRateLimit: vi.fn(),
  findFirst: vi.fn(),
  getOAuthClient: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }),
  headers: async () => new Headers(),
}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/drizzle/db", () => ({
  db: {
    query: { UserTable: { findFirst: mocks.findFirst } },
  },
}))
vi.mock("../core/rateLimit", () => ({
  enforceAuthRateLimit: mocks.enforceAuthRateLimit,
}))
vi.mock("../core/session", () => ({
  createUserSession: mocks.createUserSession,
  removeUserFromSession: vi.fn(),
}))
vi.mock("../core/oauth/base", () => ({
  getOAuthClient: mocks.getOAuthClient,
}))

import { oAuthSignIn, signIn, signUp } from "./actions"

describe("authentication action abuse controls", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enforceAuthRateLimit.mockRejectedValue(new Error("limited"))
  })

  it("stops password sign-in before a database lookup when limited", async () => {
    await expect(
      signIn({ email: "person@example.com", password: "example-password" })
    ).resolves.toBe("Unable to log you in")
    expect(mocks.findFirst).not.toHaveBeenCalled()
  })

  it("stops sign-up before a database lookup when limited", async () => {
    await expect(
      signUp({
        name: "Example Person",
        email: "person@example.com",
        password: "example-password",
      })
    ).resolves.toBe("Unable to create account")
    expect(mocks.findFirst).not.toHaveBeenCalled()
  })

  it("does not create provider state when OAuth start is limited", async () => {
    await expect(oAuthSignIn("github")).resolves.toBe(
      "Unable to start OAuth sign in"
    )
    expect(mocks.getOAuthClient).not.toHaveBeenCalled()
  })
})
