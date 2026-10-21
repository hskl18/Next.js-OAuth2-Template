"use server"

import { z } from "zod"
import { redirect } from "next/navigation"
import {
  passwordResetRequestSchema,
  setPasswordSchema,
  signInSchema,
  signUpSchema,
} from "./schemas"
import { db } from "@/drizzle/db"
import { OAuthProvider, oAuthProviders, UserTable } from "@/drizzle/schema"
import { eq, sql } from "drizzle-orm"
import {
  comparePasswords,
  generateSalt,
  hashPassword,
} from "../core/passwordHasher"
import { cookies, headers } from "next/headers"
import { createUserSession, removeUserFromSession } from "../core/session"
import { getOAuthClient } from "../core/oauth/base"
import { AuthRateLimitError, enforceAuthRateLimit } from "../core/rateLimit"
import { getClientAddress } from "./requestIdentity"
import { getCurrentUser } from "./currentUser"
import { isEmailDeliveryConfigured } from "../core/email"
import {
  consumePasswordSetupToken,
  isPasswordSetupTokenLive,
  sendPasswordSetupLink,
} from "../core/passwordSetup"

type EmailFlowResult = { ok: boolean; message: string }

const CHECK_EMAIL_MESSAGE =
  "If that email can use a password, a link to set it is on its way. It expires in one hour."
const EMAIL_UNAVAILABLE_MESSAGE =
  "Email sign-up is not available on this deployment. Use GitHub or Discord."
const INVALID_LINK_MESSAGE = "This link is invalid or has expired."

export async function signIn(unsafeData: z.infer<typeof signInSchema>) {
  const { success, data } = signInSchema.safeParse(unsafeData)

  if (!success) return "Unable to log you in"
  const clientAddress = getClientAddress(await headers())
  try {
    await enforceAuthRateLimit(
      "sign-in",
      `${clientAddress}:${data.email.trim().toLowerCase()}`
    )
  } catch {
    return "Unable to log you in"
  }

  const user = await db.query.UserTable.findFirst({
    columns: {
      password: true,
      salt: true,
      id: true,
      sessionVersion: true,
      emailVerifiedAt: true,
    },
    where: eq(sql`lower(${UserTable.email})`, data.email),
  })

  if (user == null || user.password == null || user.salt == null) {
    return "Unable to log you in"
  }

  const isCorrectPassword = await comparePasswords({
    hashedPassword: user.password,
    password: data.password,
    salt: user.salt,
  })

  if (!isCorrectPassword) return "Unable to log you in"
  // Only reachable with the correct password, so it reveals nothing new.
  if (user.emailVerifiedAt == null) {
    return "Confirm this email first: use Forgot password to set a new password."
  }

  await createUserSession(user, await cookies())

  redirect("/")
}

export async function signUp(
  unsafeData: z.infer<typeof signUpSchema>
): Promise<EmailFlowResult> {
  const { success, data } = signUpSchema.safeParse(unsafeData)
  if (!success) return { ok: false, message: "Enter your name and a valid email" }
  if (!isEmailDeliveryConfigured()) {
    return { ok: false, message: EMAIL_UNAVAILABLE_MESSAGE }
  }

  // These budgets describe only the caller, so saying so reveals nothing.
  const clientAddress = getClientAddress(await headers())
  try {
    await enforceAuthRateLimit("sign-up", `${clientAddress}:${data.email}`)
    await enforceAuthRateLimit("password-setup-client", clientAddress)
  } catch (error) {
    logPasswordSetupFailure(error)
    return { ok: false, message: "Unable to create account" }
  }

  try {
    await enforceAuthRateLimit("password-setup-email", data.email)
    // The account has no password until the mailbox holder sets one. An
    // existing email gets the same response and, when eligible, a reset link.
    await db
      .insert(UserTable)
      .values({ name: data.name, email: data.email })
      .onConflictDoNothing()
    await sendPasswordSetupLink(data.email)
  } catch (error) {
    logPasswordSetupFailure(error)
  }
  return { ok: true, message: CHECK_EMAIL_MESSAGE }
}

export async function requestPasswordReset(
  unsafeData: z.infer<typeof passwordResetRequestSchema>
): Promise<EmailFlowResult> {
  const { success, data } = passwordResetRequestSchema.safeParse(unsafeData)
  if (!success) return { ok: false, message: "Enter a valid email" }
  if (!isEmailDeliveryConfigured()) {
    return { ok: false, message: EMAIL_UNAVAILABLE_MESSAGE }
  }

  try {
    await enforceAuthRateLimit(
      "password-setup-client",
      getClientAddress(await headers())
    )
    await enforceAuthRateLimit("password-setup-email", data.email)
    await sendPasswordSetupLink(data.email)
  } catch (error) {
    logPasswordSetupFailure(error)
  }
  return { ok: true, message: CHECK_EMAIL_MESSAGE }
}

// Per-email limits and delivery failures answer like success so the response
// never reveals an address's state; operators still see everything except an
// exhausted budget, including Redis timeouts.
function logPasswordSetupFailure(error: unknown) {
  if (error instanceof AuthRateLimitError) return
  console.error("Password setup email failed", {
    error: error instanceof Error ? error.name : "UnknownError",
  })
}

export async function setPassword(
  unsafeData: z.infer<typeof setPasswordSchema>
) {
  const { success, data, error } = setPasswordSchema.safeParse(unsafeData)
  if (!success) {
    return error.issues.some(issue => issue.path[0] === "password")
      ? "Use a password of 12 to 128 characters"
      : INVALID_LINK_MESSAGE
  }
  if (!(await isPasswordSetupTokenLive(data.token))) return INVALID_LINK_MESSAGE

  const salt = generateSalt()
  const hashedPassword = await hashPassword(data.password, salt)
  const consumed = await consumePasswordSetupToken(data.token, {
    password: hashedPassword,
    salt,
  })
  if (!consumed) return INVALID_LINK_MESSAGE

  redirect("/sign-in?passwordSet=1")
}

export async function logOut() {
  await removeUserFromSession(await cookies())
  redirect("/")
}

export async function logOutEverywhere() {
  const user = await getCurrentUser({ redirectIfNotFound: true })
  await db
    .update(UserTable)
    .set({ sessionVersion: sql`${UserTable.sessionVersion} + 1` })
    .where(eq(UserTable.id, user.id))
  await removeUserFromSession(await cookies())
  redirect("/")
}

export async function oAuthSignIn(provider: OAuthProvider) {
  const parsedProvider = z.enum(oAuthProviders).safeParse(provider)
  if (!parsedProvider.success) return "Unable to start OAuth sign in"
  const clientAddress = getClientAddress(await headers())
  try {
    await enforceAuthRateLimit(
      "oauth-start",
      `${clientAddress}:${parsedProvider.data}`
    )
  } catch {
    return "Unable to start OAuth sign in"
  }
  const oAuthClient = getOAuthClient(parsedProvider.data)
  redirect(oAuthClient.createAuthUrl(await cookies()))
}
