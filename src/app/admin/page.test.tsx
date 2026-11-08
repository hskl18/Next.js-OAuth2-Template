import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url })
  }),
}))

vi.mock("@/auth/nextjs/currentUser", () => ({
  getCurrentUser: mocks.getCurrentUser,
}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

import AdminPage from "./page"

describe("AdminPage authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("requires a signed-in user", async () => {
    mocks.getCurrentUser.mockRejectedValue(
      Object.assign(new Error("NEXT_REDIRECT"), { url: "/sign-in" })
    )

    await expect(AdminPage()).rejects.toMatchObject({ url: "/sign-in" })
    expect(mocks.getCurrentUser).toHaveBeenCalledWith({
      redirectIfNotFound: true,
    })
  })

  it("redirects a regular user away from the admin page", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1", role: "user" })

    await expect(AdminPage()).rejects.toMatchObject({ url: "/" })
  })

  it("renders for an admin", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "admin-1", role: "admin" })

    expect(renderToStaticMarkup(await AdminPage())).toContain("Admin")
  })
})
