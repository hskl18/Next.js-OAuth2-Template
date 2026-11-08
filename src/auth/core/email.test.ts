import { afterEach, describe, expect, it, vi } from "vitest"
import {
  EmailDeliveryNotConfiguredError,
  isEmailDeliveryConfigured,
  sendAuthEmail,
} from "./email"

const email = { to: "person@example.com", subject: "Subject", text: "Body" }

describe("auth email transport", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("refuses to send in production until a provider is wired in", async () => {
    vi.stubEnv("NODE_ENV", "production")

    expect(isEmailDeliveryConfigured()).toBe(false)
    await expect(sendAuthEmail(email)).rejects.toBeInstanceOf(
      EmailDeliveryNotConfiguredError
    )
  })

  it("prints the message to the console in development", async () => {
    vi.stubEnv("NODE_ENV", "development")
    const info = vi.spyOn(console, "info").mockImplementation(() => {})

    await sendAuthEmail(email)

    expect(info).toHaveBeenCalledWith(expect.stringContaining("Body"))
  })
})
