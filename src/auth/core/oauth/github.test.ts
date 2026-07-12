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

import { createGithubOAuthClient } from "./github"

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

describe("GitHub OAuth identity", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("uses the verified primary email endpoint when the public email is null", async () => {
    const cookies = new CookieJar()
    const client = createGithubOAuthClient()
    const authUrl = new URL(client.createAuthUrl(cookies))
    const state = authUrl.searchParams.get("state")
    if (state == null) throw new Error("Missing test state")

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ access_token: "example_access_token", token_type: "bearer" })
      )
      .mockResolvedValueOnce(
        Response.json({ id: 42, name: null, login: "octocat", email: null })
      )
      .mockResolvedValueOnce(
        Response.json([
          {
            email: "secondary@example.com",
            primary: false,
            verified: true,
            visibility: null,
          },
          {
            email: "primary@example.com",
            primary: true,
            verified: true,
            visibility: "private",
          },
        ])
      )

    await expect(
      client.fetchUser("authorization-code", state, cookies)
    ).resolves.toEqual({
      id: "42",
      name: "octocat",
      email: "primary@example.com",
    })
    expect(fetchSpy).toHaveBeenCalledTimes(3)
    expect(fetchSpy.mock.calls[2]?.[0]).toBe("https://api.github.com/user/emails")
  })

  it("rejects GitHub identity when no primary email is verified", async () => {
    const cookies = new CookieJar()
    const client = createGithubOAuthClient()
    const authUrl = new URL(client.createAuthUrl(cookies))
    const state = authUrl.searchParams.get("state")
    if (state == null) throw new Error("Missing test state")

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ access_token: "example_access_token", token_type: "bearer" })
      )
      .mockResolvedValueOnce(
        Response.json({ id: 42, name: null, login: "octocat", email: null })
      )
      .mockResolvedValueOnce(
        Response.json([
          {
            email: "primary@example.com",
            primary: true,
            verified: false,
            visibility: null,
          },
        ])
      )

    await expect(
      client.fetchUser("authorization-code", state, cookies)
    ).rejects.toThrow("GitHub account does not expose a verified primary email")
  })
})
