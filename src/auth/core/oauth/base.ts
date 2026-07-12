import { env } from "@/data/env/server"
import { Cookies } from "../session"
import { z } from "zod"
import crypto from "crypto"
import { OAuthProvider } from "@/drizzle/schema"
import { createDiscordOAuthClient } from "./discord"
import { createGithubOAuthClient } from "./github"

const STATE_COOKIE_KEY = "oAuthState"
const CODE_VERIFIER_COOKIE_KEY = "oAuthCodeVerifier"
// Ten minutes in seconds
const COOKIE_EXPIRATION_SECONDS = 60 * 10
const PROVIDER_REQUEST_TIMEOUT_MS = 5_000

type OAuthIdentity = { id: string; email: string; name: string }
type UserInfoFetcher = <U>(url: string, schema: z.ZodSchema<U>) => Promise<U>

export class OAuthClient<T> {
  private readonly provider: OAuthProvider
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly scopes: string[]
  private readonly urls: {
    auth: string
    token: string
    user: string
  }
  private readonly userInfo: {
    schema: z.ZodSchema<T>
    parser: (
      data: T,
      context: { fetch: UserInfoFetcher }
    ) => OAuthIdentity | Promise<OAuthIdentity>
  }
  private readonly tokenSchema = z.object({
    access_token: z.string().min(1).max(4_096),
    token_type: z
      .string()
      .transform(value => value.toLowerCase())
      .pipe(z.literal("bearer")),
  })

  constructor({
    provider,
    clientId,
    clientSecret,
    scopes,
    urls,
    userInfo,
  }: {
    provider: OAuthProvider
    clientId: string
    clientSecret: string
    scopes: string[]
    urls: {
      auth: string
      token: string
      user: string
    }
    userInfo: {
      schema: z.ZodSchema<T>
      parser: (
        data: T,
        context: { fetch: UserInfoFetcher }
      ) => OAuthIdentity | Promise<OAuthIdentity>
    }
  }) {
    this.provider = provider
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.scopes = scopes
    this.urls = urls
    this.userInfo = userInfo
  }

  private get redirectUrl() {
    return new URL(this.provider, env.OAUTH_REDIRECT_URL_BASE)
  }

  createAuthUrl(cookies: Pick<Cookies, "set">) {
    const state = createState(cookies)
    const codeVerifier = createCodeVerifier(cookies)
    const url = new URL(this.urls.auth)
    url.searchParams.set("client_id", this.clientId)
    url.searchParams.set("redirect_uri", this.redirectUrl.toString())
    url.searchParams.set("response_type", "code")
    url.searchParams.set("scope", this.scopes.join(" "))
    url.searchParams.set("state", state)
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set(
      "code_challenge",
      crypto.hash("sha256", codeVerifier, "base64url")
    )
    return url.toString()
  }

  discardAuthAttempt(
    state: string,
    cookies: Pick<Cookies, "get" | "delete">
  ) {
    const attempt = consumeOAuthAttempt(cookies)
    if (!constantTimeEqual(attempt.state, state)) throw new InvalidStateError()
  }

  clearAuthAttempt(cookies: Pick<Cookies, "get" | "delete">) {
    consumeOAuthAttempt(cookies)
  }

  async fetchUser(
    code: string,
    state: string,
    cookies: Pick<Cookies, "get" | "delete">
  ) {
    const attempt = consumeOAuthAttempt(cookies)
    if (!constantTimeEqual(attempt.state, state)) throw new InvalidStateError()
    if (attempt.codeVerifier == null) throw new InvalidCodeVerifierError()

    const { accessToken, tokenType } = await this.fetchToken(
      code,
      attempt.codeVerifier
    )

    const fetchUserInfo: UserInfoFetcher = async (url, schema) => {
      const rawData = await fetchProviderJson(url, {
        headers: {
          Accept: "application/json",
          Authorization: `${tokenType} ${accessToken}`,
        },
      })
      const { data, success, error } = schema.safeParse(rawData)
      if (!success) throw new InvalidUserError(error)
      return data
    }
    const user = await fetchUserInfo(this.urls.user, this.userInfo.schema)

    return this.userInfo.parser(user, { fetch: fetchUserInfo })
  }

  private fetchToken(code: string, codeVerifier: string) {
    return fetchProviderJson(this.urls.token, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        code,
        redirect_uri: this.redirectUrl.toString(),
        grant_type: "authorization_code",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code_verifier: codeVerifier,
      }),
    }).then(rawData => {
      const { data, success, error } = this.tokenSchema.safeParse(rawData)
      if (!success) throw new InvalidTokenError(error)

      return {
        accessToken: data.access_token,
        tokenType: data.token_type,
      }
    })
  }
}

export function getOAuthClient(provider: OAuthProvider) {
  switch (provider) {
    case "discord":
      return createDiscordOAuthClient()
    case "github":
      return createGithubOAuthClient()
    default:
      throw new Error(`Invalid provider: ${provider satisfies never}`)
  }
}

class InvalidTokenError extends Error {
  constructor(zodError: z.ZodError) {
    super("Invalid Token")
    this.name = "InvalidTokenError"
    this.cause = zodError
  }
}

class InvalidUserError extends Error {
  constructor(zodError: z.ZodError) {
    super("Invalid User")
    this.name = "InvalidUserError"
    this.cause = zodError
  }
}

class InvalidStateError extends Error {
  constructor() {
    super("Invalid State")
    this.name = "InvalidStateError"
  }
}

class InvalidCodeVerifierError extends Error {
  constructor() {
    super("Invalid Code Verifier")
    this.name = "InvalidCodeVerifierError"
  }
}

class OAuthProviderResponseError extends Error {
  constructor() {
    super("OAuth provider request failed")
    this.name = "OAuthProviderResponseError"
  }
}

async function fetchProviderJson(url: string, init: RequestInit) {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new OAuthProviderResponseError()
  }
  if (!response.ok) throw new OAuthProviderResponseError()

  try {
    return await response.json()
  } catch {
    throw new OAuthProviderResponseError()
  }
}

function createState(cookies: Pick<Cookies, "set">) {
  const state = crypto.randomBytes(64).toString("hex").normalize()
  cookies.set(STATE_COOKIE_KEY, state, {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    expires: Date.now() + COOKIE_EXPIRATION_SECONDS * 1000,
    path: "/",
  })
  return state
}

function createCodeVerifier(cookies: Pick<Cookies, "set">) {
  const codeVerifier = crypto.randomBytes(64).toString("hex").normalize()
  cookies.set(CODE_VERIFIER_COOKIE_KEY, codeVerifier, {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    expires: Date.now() + COOKIE_EXPIRATION_SECONDS * 1000,
    path: "/",
  })
  return codeVerifier
}

function consumeOAuthAttempt(cookies: Pick<Cookies, "get" | "delete">) {
  const attempt = {
    state: cookies.get(STATE_COOKIE_KEY)?.value,
    codeVerifier: cookies.get(CODE_VERIFIER_COOKIE_KEY)?.value,
  }
  cookies.delete(STATE_COOKIE_KEY)
  cookies.delete(CODE_VERIFIER_COOKIE_KEY)
  return attempt
}

function constantTimeEqual(expected: string | undefined, actual: string) {
  if (expected == null) return false
  if (expected.length !== actual.length) return false
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer)
}
