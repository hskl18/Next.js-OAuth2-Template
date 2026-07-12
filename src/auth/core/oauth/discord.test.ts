import { afterEach, describe, expect, it, vi } from "vitest"
import type { Cookies } from "../session"

vi.mock("@/data/env/server", () => ({
  env: {
    DISCORD_CLIENT_ID: "example_discord_client_id",
    DISCORD_CLIENT_SECRET: "example_discord_client_secret",
    GITHUB_CLIENT_ID: "example_github_client_id",
    GITHUB_CLIENT_SECRET: "example_github_client_secret",
    OAUTH_REDIRECT_URL_BASE: "http://localhost:3000/api/oauth/",
  },
}))

import { createDiscordOAuthClient } from "./discord"

type CookieOptions = Parameters<Cookies["set"]>[2]

class CookieJar {
  private readonly values = new Map<string, string>()

  set(key: string, value: string, options: CookieOptions) {
    void options
    this.values.set(key, value)
  }

  get(key: string) {
    const value = this.values.get(key)
    return value == null ? undefined : { name: key, value }
  }

  delete(key: string) {
    this.values.delete(key)
  }
}

describe("Discord OAuth identity", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("rejects an account whose provider email is unverified", async () => {
    const cookies = new CookieJar()
    const client = createDiscordOAuthClient()
    const authUrl = new URL(client.createAuthUrl(cookies))
    const state = authUrl.searchParams.get("state")
    if (state == null) throw new Error("Missing test state")

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ access_token: "example_access_token", token_type: "bearer" })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "42",
          username: "example-user",
          global_name: null,
          email: "user@example.com",
          verified: false,
        })
      )

    await expect(
      client.fetchUser("authorization-code", state, cookies)
    ).rejects.toThrow("Invalid User")
  })
})
