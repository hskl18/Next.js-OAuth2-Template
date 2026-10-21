"use server"

import { z } from "zod"
import { redirect } from "next/navigation"
import { signInSchema, signUpSchema } from "./schemas"
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
import { enforceAuthRateLimit } from "../core/rateLimit"
import { getClientAddress } from "./requestIdentity"
import { getCurrentUser } from "./currentUser"

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
    columns: { password: true, salt: true, id: true, sessionVersion: true },
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

  await createUserSession(user, await cookies())

  redirect("/")
}

export async function signUp(unsafeData: z.infer<typeof signUpSchema>) {
  const { success, data } = signUpSchema.safeParse(unsafeData)

  if (!success) return "Unable to create account"
  const clientAddress = getClientAddress(await headers())
  try {
    await enforceAuthRateLimit(
      "sign-up",
      `${clientAddress}:${data.email.trim().toLowerCase()}`
    )
  } catch {
    return "Unable to create account"
  }

  const existingUser = await db.query.UserTable.findFirst({
    where: eq(sql`lower(${UserTable.email})`, data.email),
  })

  if (existingUser != null) return "Unable to create account"

  try {
    const salt = generateSalt()
    const hashedPassword = await hashPassword(data.password, salt)

    const [user] = await db
      .insert(UserTable)
      .values({
        name: data.name,
        email: data.email,
        password: hashedPassword,
        salt,
      })
      .returning({ id: UserTable.id, sessionVersion: UserTable.sessionVersion })

    if (user == null) return "Unable to create account"
    await createUserSession(user, await cookies())
  } catch {
    return "Unable to create account"
  }

  redirect("/")
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
