import { PgDialect } from "drizzle-orm/pg-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createUserSession: vi.fn(),
  enforceAuthRateLimit: vi.fn(),
  findFirst: vi.fn(),
  getCurrentUser: vi.fn(),
  getOAuthClient: vi.fn(),
  redirect: vi.fn(),
  removeUserFromSession: vi.fn(),
  update: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }),
  headers: async () => new Headers(),
}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/drizzle/db", () => ({
  db: {
    query: { UserTable: { findFirst: mocks.findFirst } },
    update: mocks.update,
  },
}))
vi.mock("../core/rateLimit", () => ({
  enforceAuthRateLimit: mocks.enforceAuthRateLimit,
}))
vi.mock("../core/session", () => ({
  createUserSession: mocks.createUserSession,
  removeUserFromSession: mocks.removeUserFromSession,
}))
vi.mock("../core/oauth/base", () => ({
  getOAuthClient: mocks.getOAuthClient,
}))
vi.mock("./currentUser", () => ({ getCurrentUser: mocks.getCurrentUser }))

import { logOutEverywhere, oAuthSignIn, signIn, signUp } from "./actions"

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

describe("sign-out-everywhere", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("revokes every session before clearing the current one", async () => {
    const where = vi.fn().mockResolvedValue(undefined)
    const set = vi.fn().mockReturnValue({ where })
    mocks.update.mockReturnValue({ set })
    mocks.getCurrentUser.mockResolvedValue({ id: "user-42", role: "user" })

    await logOutEverywhere()

    expect(mocks.getCurrentUser).toHaveBeenCalledWith({
      redirectIfNotFound: true,
    })
    const dialect = new PgDialect()
    expect(dialect.sqlToQuery(set.mock.calls[0]?.[0].sessionVersion)).toEqual({
      sql: '"users"."sessionVersion" + 1',
      params: [],
    })
    expect(dialect.sqlToQuery(where.mock.calls[0]?.[0])).toMatchObject({
      sql: '"users"."id" = $1',
      params: ["user-42"],
    })
    expect(where.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.removeUserFromSession.mock.invocationCallOrder[0]!
    )
    expect(mocks.redirect).toHaveBeenCalledWith("/")
  })

  it("does not touch sessions for a caller without a valid session", async () => {
    mocks.getCurrentUser.mockRejectedValue(new Error("NEXT_REDIRECT"))

    await expect(logOutEverywhere()).rejects.toThrow("NEXT_REDIRECT")
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.removeUserFromSession).not.toHaveBeenCalled()
  })
})
