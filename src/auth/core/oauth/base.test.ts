import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
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

import { OAuthClient } from "./base"

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

function createTestClient() {
  return new OAuthClient({
    provider: "github",
    clientId: "example_client_id",
    clientSecret: "example_client_secret",
    scopes: ["read:user"],
    urls: {
      auth: "https://provider.example/authorize",
      token: "https://provider.example/token",
      user: "https://provider.example/user",
    },
    userInfo: {
      schema: z.object({
        id: z.string(),
        email: z.string().email(),
        name: z.string(),
      }),
      parser: user => user,
    },
  })
}

describe("OAuth attempt cookies", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("rejects a state mismatch and consumes both one-time cookies", async () => {
    const cookies = new CookieJar()
    const client = createTestClient()
    client.createAuthUrl(cookies)
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    await expect(
      client.fetchUser("authorization-code", "attacker-state", cookies)
    ).rejects.toThrow("Invalid State")

    expect(cookies.get("oAuthState")).toBeUndefined()
    expect(cookies.get("oAuthCodeVerifier")).toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects a non-success token response without trusting its payload", async () => {
    const cookies = new CookieJar()
    const client = createTestClient()
    const authUrl = new URL(client.createAuthUrl(cookies))
    const state = authUrl.searchParams.get("state")
    if (state == null) throw new Error("Missing test state")
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json(
        {
          access_token: "attacker-controlled-token",
          token_type: "bearer",
        },
        { status: 401 }
      )
    )

    await expect(
      client.fetchUser("authorization-code", state, cookies)
    ).rejects.toThrow("OAuth provider request failed")
  })

  it("consumes a valid attempt when the user denies provider authorization", () => {
    const cookies = new CookieJar()
    const client = createTestClient()
    const authUrl = new URL(client.createAuthUrl(cookies))
    const state = authUrl.searchParams.get("state")
    if (state == null) throw new Error("Missing test state")

    expect(() => client.discardAuthAttempt(state, cookies)).not.toThrow()
    expect(cookies.get("oAuthState")).toBeUndefined()
    expect(cookies.get("oAuthCodeVerifier")).toBeUndefined()
  })

  it("rejects a missing PKCE verifier and still consumes the state", async () => {
    const cookies = new CookieJar()
    const client = createTestClient()
    const authUrl = new URL(client.createAuthUrl(cookies))
    const state = authUrl.searchParams.get("state")
    if (state == null) throw new Error("Missing test state")
    cookies.delete("oAuthCodeVerifier")

    await expect(
      client.fetchUser("authorization-code", state, cookies)
    ).rejects.toThrow("Invalid Code Verifier")
    expect(cookies.get("oAuthState")).toBeUndefined()
  })

  it("rejects callback replay after a successful one-time exchange", async () => {
    const cookies = new CookieJar()
    const client = createTestClient()
    const authUrl = new URL(client.createAuthUrl(cookies))
    const state = authUrl.searchParams.get("state")
    if (state == null) throw new Error("Missing test state")
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ access_token: "example_access_token", token_type: "bearer" })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "provider-user-42",
          email: "person@example.com",
          name: "Example Person",
        })
      )

    await expect(
      client.fetchUser("authorization-code", state, cookies)
    ).resolves.toEqual({
      id: "provider-user-42",
      email: "person@example.com",
      name: "Example Person",
    })
    await expect(
      client.fetchUser("authorization-code", state, cookies)
    ).rejects.toThrow("Invalid State")
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
