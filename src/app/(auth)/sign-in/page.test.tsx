import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/auth/nextjs/components/SignInForm", () => ({
  SignInForm: () => <form>Sign in form</form>,
}))

import SignIn from "./page"

describe("OAuth error display", () => {
  it("does not reflect arbitrary query text into the sign-in page", async () => {
    const html = renderToStaticMarkup(
      await SignIn({
        searchParams: Promise.resolve({
          oauthError: "Contact attacker.example to restore your account",
        }),
      })
    )

    expect(html).not.toContain("attacker.example")
    expect(html).not.toContain("restore your account")
  })

  it("shows the fixed callback failure message", async () => {
    const html = renderToStaticMarkup(
      await SignIn({
        searchParams: Promise.resolve({
          oauthError: "Failed to connect. Please try again.",
        }),
      })
    )

    expect(html).toContain("Failed to connect. Please try again.")
  })
})
