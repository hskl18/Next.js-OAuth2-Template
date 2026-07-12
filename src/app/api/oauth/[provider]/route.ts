import { getOAuthClient } from "@/auth/core/oauth/base"
import { resolveOAuthLogin } from "@/auth/core/oauth/account"
import { oauthAccountStore } from "@/auth/core/oauth/postgresAccountStore"
import { createUserSession } from "@/auth/core/session"
import { oAuthProviders } from "@/drizzle/schema"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { NextRequest } from "next/server"
import { z } from "zod"
import { enforceAuthRateLimit } from "@/auth/core/rateLimit"
import { getClientAddress } from "@/auth/nextjs/requestIdentity"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: rawProvider } = await params
  const codeResult = z
    .string()
    .min(1)
    .max(4_096)
    .safeParse(request.nextUrl.searchParams.get("code"))
  const stateResult = z
    .string()
    .regex(/^[a-f0-9]{128}$/)
    .safeParse(request.nextUrl.searchParams.get("state"))
  const state = stateResult.success ? stateResult.data : null
  const providerResult = z.enum(oAuthProviders).safeParse(rawProvider)
  if (!providerResult.success) redirectOAuthError()
  const provider = providerResult.data
  const oAuthClient = getOAuthClient(provider)
  const cookieStore = await cookies()
  try {
    await enforceAuthRateLimit(
      "oauth-callback",
      `${getClientAddress(request.headers)}:${provider}`
    )
  } catch {
    oAuthClient.clearAuthAttempt(cookieStore)
    redirectOAuthError()
  }

  if (request.nextUrl.searchParams.has("error")) {
    try {
      if (state == null) oAuthClient.clearAuthAttempt(cookieStore)
      else oAuthClient.discardAuthAttempt(state, cookieStore)
    } catch {
      // The public response is intentionally identical for denial and bad state.
    }
    redirectOAuthError()
  }

  if (!codeResult.success || state == null) {
    oAuthClient.clearAuthAttempt(cookieStore)
    redirectOAuthError()
  }

  try {
    const oAuthUser = await oAuthClient.fetchUser(
      codeResult.data,
      state,
      cookieStore
    )
    const user = await resolveOAuthLogin(
      {
        provider,
        providerAccountId: oAuthUser.id,
        email: oAuthUser.email,
        name: oAuthUser.name,
      },
      oauthAccountStore
    )
    await createUserSession(user, cookieStore)
  } catch (error) {
    console.error("OAuth callback failed", {
      provider,
      error: error instanceof Error ? error.name : "UnknownError",
    })
    redirectOAuthError()
  }

  redirect("/")
}

function redirectOAuthError(): never {
  redirect(
    `/sign-in?oauthError=${encodeURIComponent(
      "Failed to connect. Please try again."
    )}`
  )
}
