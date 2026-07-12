import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}))

vi.mock("@/auth/nextjs/currentUser", () => ({
  getCurrentUser: mocks.getCurrentUser,
}))
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock("./DropAdminRoleButton", () => ({
  DropAdminRoleButton: () => <button>Drop admin access</button>,
}))

import PrivatePage from "./page"

describe("PrivatePage role controls", () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1", role: "user" })
  })

  it("does not render the admin access control for a regular user", async () => {
    const html = renderToStaticMarkup(await PrivatePage())

    expect(html).not.toContain("Drop admin access")
  })

  it("renders the admin access control for an admin", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "admin-1", role: "admin" })

    const html = renderToStaticMarkup(await PrivatePage())

    expect(html).toContain("Drop admin access")
  })
})
