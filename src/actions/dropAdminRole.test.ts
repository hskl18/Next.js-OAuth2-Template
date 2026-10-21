import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  revalidatePath: vi.fn(),
  update: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/auth/nextjs/currentUser", () => ({
  getCurrentUser: mocks.getCurrentUser,
}))
vi.mock("@/drizzle/db", () => ({ db: { update: mocks.update } }))
vi.mock("@/drizzle/schema", () => ({
  UserTable: { id: "users.id", role: "users.role" },
}))
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }))

import { dropAdminRole } from "./dropAdminRole"

describe("dropAdminRole authorization", () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1", role: "user" })
  })

  it("redirects an anonymous caller before any role mutation", async () => {
    mocks.getCurrentUser.mockRejectedValue(new Error("NEXT_REDIRECT"))

    await expect(dropAdminRole()).rejects.toThrow("NEXT_REDIRECT")

    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("prevents a regular user from invoking the admin-only action", async () => {
    await expect(dropAdminRole()).rejects.toThrow("Forbidden")

    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("fails clearly when the admin row no longer exists", async () => {
    const returning = vi.fn().mockResolvedValue([])
    const where = vi.fn().mockReturnValue({ returning })
    const set = vi.fn().mockReturnValue({ where })
    mocks.getCurrentUser.mockResolvedValue({ id: "admin-1", role: "admin" })
    mocks.update.mockReturnValue({ set })

    await expect(dropAdminRole()).rejects.toThrow(
      "Failed to drop admin access: user was not updated"
    )

    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("allows an admin to drop their access to the user role", async () => {
    const updatedUser = { id: "admin-1" }
    const returning = vi.fn().mockResolvedValue([updatedUser])
    const where = vi.fn().mockReturnValue({ returning })
    const set = vi.fn().mockReturnValue({ where })
    mocks.getCurrentUser.mockResolvedValue({ id: "admin-1", role: "admin" })
    mocks.update.mockReturnValue({ set })

    await expect(dropAdminRole()).resolves.toBeUndefined()

    expect(set).toHaveBeenCalledWith({ role: "user" })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/private")
  })
})
