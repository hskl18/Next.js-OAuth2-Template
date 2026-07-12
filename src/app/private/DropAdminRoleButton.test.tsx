import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  useFormStatus: vi.fn(),
}))

vi.mock("react-dom", async importOriginal => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormStatus: mocks.useFormStatus,
}))

import { DropAdminRoleButton } from "./DropAdminRoleButton"

describe("DropAdminRoleButton", () => {
  beforeEach(() => {
    mocks.useFormStatus.mockReturnValue({ pending: false })
  })

  it("submits the surrounding form when idle", () => {
    const html = renderToStaticMarkup(<DropAdminRoleButton />)

    expect(html).toContain('type="submit"')
    expect(html).toContain("Drop admin access")
    expect(html).not.toMatch(/<button[^>]*\sdisabled(?:=| |>)/)
  })

  it("disables repeat submissions while the action is pending", () => {
    mocks.useFormStatus.mockReturnValue({ pending: true })

    const html = renderToStaticMarkup(<DropAdminRoleButton />)

    expect(html).toMatch(/<button[^>]*\sdisabled(?:=| |>)/)
    expect(html).toContain("Dropping admin access...")
  })
})
