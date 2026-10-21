import { PgDialect } from "drizzle-orm/pg-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  AuthRateLimitError: class AuthRateLimitError extends Error {},
  comparePasswords: vi.fn(),
  consumePasswordSetupToken: vi.fn(),
  createUserSession: vi.fn(),
  hashPassword: vi.fn(),
  insert: vi.fn(),
  isPasswordSetupTokenLive: vi.fn(),
  sendPasswordSetupLink: vi.fn(),
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
    insert: mocks.insert,
    update: mocks.update,
  },
}))
vi.mock("../core/rateLimit", () => ({
  AuthRateLimitError: mocks.AuthRateLimitError,
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
vi.mock("../core/passwordHasher", () => ({
  comparePasswords: mocks.comparePasswords,
  generateSalt: () => "salt",
  hashPassword: mocks.hashPassword,
}))
vi.mock("../core/passwordSetup", () => ({
  consumePasswordSetupToken: mocks.consumePasswordSetupToken,
  isPasswordSetupTokenLive: mocks.isPasswordSetupTokenLive,
  sendPasswordSetupLink: mocks.sendPasswordSetupLink,
}))

import {
  logOutEverywhere,
  oAuthSignIn,
  requestPasswordReset,
  setPassword,
  signIn,
  signUp,
} from "./actions"

const CHECK_EMAIL =
  "If that email can use a password, a link to set it is on its way. It expires in one hour."
const INVALID_LINK = "This link is invalid or has expired."
const token = "a".repeat(43)

describe("authentication action abuse controls", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enforceAuthRateLimit.mockRejectedValue(new mocks.AuthRateLimitError())
  })

  it("stops password sign-in before a database lookup when limited", async () => {
    await expect(
      signIn({ email: "person@example.com", password: "example-password" })
    ).resolves.toBe("Unable to log you in")
    expect(mocks.findFirst).not.toHaveBeenCalled()
  })

  it("stops sign-up before any write or email when limited", async () => {
    await expect(
      signUp({ name: "Example Person", email: "person@example.com" })
    ).resolves.toEqual({ ok: false, message: "Unable to create account" })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.sendPasswordSetupLink).not.toHaveBeenCalled()
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

describe("email ownership flows", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enforceAuthRateLimit.mockResolvedValue(undefined)
  })

  it("creates a passwordless account and emails a setup link without signing in", async () => {
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
    const values = vi.fn().mockReturnValue({ onConflictDoNothing })
    mocks.insert.mockReturnValue({ values })

    await expect(
      signUp({ name: "Example Person", email: " Person@Example.com " })
    ).resolves.toEqual({ ok: true, message: CHECK_EMAIL })

    expect(values).toHaveBeenCalledWith({
      name: "Example Person",
      email: "person@example.com",
    })
    expect(onConflictDoNothing).toHaveBeenCalledOnce()
    expect(mocks.sendPasswordSetupLink).toHaveBeenCalledWith("person@example.com")
    expect(mocks.createUserSession).not.toHaveBeenCalled()
  })

  it("answers sign-up like success when the address's shared budget is spent", async () => {
    mocks.enforceAuthRateLimit.mockImplementation(async (scope: string) => {
      if (scope === "password-setup-email") throw new mocks.AuthRateLimitError()
    })
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      signUp({ name: "Example Person", email: "person@example.com" })
    ).resolves.toEqual({ ok: true, message: CHECK_EMAIL })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.sendPasswordSetupLink).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it("answers a reset request identically when sent, limited, or failing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      requestPasswordReset({ email: "person@example.com" })
    ).resolves.toEqual({ ok: true, message: CHECK_EMAIL })

    mocks.enforceAuthRateLimit.mockRejectedValueOnce(
      new mocks.AuthRateLimitError()
    )
    await expect(
      requestPasswordReset({ email: "person@example.com" })
    ).resolves.toEqual({ ok: true, message: CHECK_EMAIL })

    mocks.sendPasswordSetupLink.mockRejectedValueOnce(new Error("smtp down"))
    await expect(
      requestPasswordReset({ email: "person@example.com" })
    ).resolves.toEqual({ ok: true, message: CHECK_EMAIL })
    // Hidden from the caller, visible to operators.
    expect(error).toHaveBeenCalledOnce()

    mocks.enforceAuthRateLimit.mockRejectedValueOnce(new Error("redis timeout"))
    await expect(
      requestPasswordReset({ email: "person@example.com" })
    ).resolves.toEqual({ ok: true, message: CHECK_EMAIL })
    expect(error).toHaveBeenCalledTimes(2)
  })

  it("rejects an unknown setup link before hashing the password", async () => {
    mocks.isPasswordSetupTokenLive.mockResolvedValue(false)

    await expect(
      setPassword({ token, password: "a valid new password" })
    ).resolves.toBe(INVALID_LINK)
    expect(mocks.hashPassword).not.toHaveBeenCalled()
    expect(mocks.consumePasswordSetupToken).not.toHaveBeenCalled()
  })

  it("reports a link consumed by a concurrent request as invalid", async () => {
    mocks.isPasswordSetupTokenLive.mockResolvedValue(true)
    mocks.hashPassword.mockResolvedValue("hashed")
    mocks.consumePasswordSetupToken.mockResolvedValue(false)

    await expect(
      setPassword({ token, password: "a valid new password" })
    ).resolves.toBe(INVALID_LINK)
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it("stores the new hash and sends the user to sign in", async () => {
    mocks.isPasswordSetupTokenLive.mockResolvedValue(true)
    mocks.hashPassword.mockResolvedValue("hashed")
    mocks.consumePasswordSetupToken.mockResolvedValue(true)

    await setPassword({ token, password: "a valid new password" })

    expect(mocks.hashPassword).toHaveBeenCalledWith("a valid new password", "salt")
    expect(mocks.consumePasswordSetupToken).toHaveBeenCalledWith(token, {
      password: "hashed",
      salt: "salt",
    })
    expect(mocks.redirect).toHaveBeenCalledWith("/sign-in?passwordSet=1")
  })

  it("explains a short password instead of an invalid link", async () => {
    await expect(setPassword({ token, password: "short" })).resolves.toBe(
      "Use a password of 12 to 128 characters"
    )
  })

  it("rejects a malformed action payload without throwing", async () => {
    await expect(
      setPassword(null as unknown as Parameters<typeof setPassword>[0])
    ).resolves.toBe(INVALID_LINK)
  })

  it("does not sign in a legacy password account whose email was never confirmed", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "user-42",
      password: "hash",
      salt: "salt",
      sessionVersion: 0,
      emailVerifiedAt: null,
    })
    mocks.comparePasswords.mockResolvedValue(true)

    await expect(
      signIn({ email: "person@example.com", password: "the right password" })
    ).resolves.toBe(
      "Confirm this email first: use Forgot password to set a new password."
    )
    expect(mocks.createUserSession).not.toHaveBeenCalled()
  })
})
