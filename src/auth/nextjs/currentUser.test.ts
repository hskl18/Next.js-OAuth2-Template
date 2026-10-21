import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  getUserFromSession: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url })
  }),
}))

vi.mock("next/headers", () => ({ cookies: async () => ({}) }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("../core/session", () => ({
  getUserFromSession: mocks.getUserFromSession,
}))
vi.mock("@/drizzle/db", () => ({
  db: { query: { UserTable: { findFirst: mocks.findFirst } } },
}))

import { getCurrentUser } from "./currentUser"

const databaseUser = {
  id: "user-42",
  email: "person@example.com",
  name: "Example Person",
  role: "user" as const,
  sessionVersion: 2,
}

describe("current user authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUserFromSession.mockResolvedValue({
      id: "user-42",
      sessionVersion: 2,
      expiresAt: Date.now() + 60_000,
    })
  })

  it("takes the role from the database row, not the session", async () => {
    mocks.findFirst.mockResolvedValueOnce({ ...databaseUser, role: "admin" })
    await expect(getCurrentUser()).resolves.toMatchObject({ role: "admin" })

    mocks.findFirst.mockResolvedValueOnce(databaseUser)
    await expect(getCurrentUser()).resolves.toMatchObject({ role: "user" })
  })

  it("rejects a session issued before sign-out-everywhere", async () => {
    mocks.findFirst.mockResolvedValue({ ...databaseUser, sessionVersion: 3 })

    await expect(getCurrentUser()).resolves.toBeNull()
    await expect(
      getCurrentUser({ redirectIfNotFound: true })
    ).rejects.toMatchObject({ url: "/sign-in" })
  })

  it("rejects a session whose user no longer exists", async () => {
    mocks.findFirst.mockResolvedValue(undefined)

    await expect(getCurrentUser()).resolves.toBeNull()
  })

  it("does not query the database without a session", async () => {
    mocks.getUserFromSession.mockResolvedValue(null)

    await expect(getCurrentUser()).resolves.toBeNull()
    expect(mocks.findFirst).not.toHaveBeenCalled()
  })
})
