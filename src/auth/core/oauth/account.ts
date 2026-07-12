import type { OAuthProvider, UserRole } from "@/drizzle/schema"

export type AuthenticatedUser = { id: string; role: UserRole }

export type VerifiedOAuthIdentity = {
  provider: OAuthProvider
  providerAccountId: string
  email: string
  name: string
}

export interface OAuthAccountStore {
  findByProviderAccount(
    provider: OAuthProvider,
    providerAccountId: string
  ): Promise<AuthenticatedUser | null>
  findByEmail(email: string): Promise<AuthenticatedUser | null>
  createUserWithAccount(
    identity: VerifiedOAuthIdentity
  ): Promise<AuthenticatedUser>
}

export async function resolveOAuthLogin(
  rawIdentity: VerifiedOAuthIdentity,
  store: OAuthAccountStore
) {
  const identity = {
    ...rawIdentity,
    email: rawIdentity.email.trim().toLowerCase(),
  }
  const linkedUser = await store.findByProviderAccount(
    identity.provider,
    identity.providerAccountId
  )
  if (linkedUser != null) return linkedUser

  const existingEmailUser = await store.findByEmail(identity.email)
  if (existingEmailUser != null) throw new AccountLinkRequiredError()

  try {
    return await store.createUserWithAccount(identity)
  } catch (error) {
    if (!(error instanceof OAuthAccountConflictError)) throw error

    const providerWinner = await store.findByProviderAccount(
      identity.provider,
      identity.providerAccountId
    )
    if (providerWinner != null) return providerWinner

    const emailWinner = await store.findByEmail(identity.email)
    if (emailWinner != null) throw new AccountLinkRequiredError()
    throw error
  }
}

export class AccountLinkRequiredError extends Error {
  constructor() {
    super("Sign in to the existing account before linking this provider")
    this.name = "AccountLinkRequiredError"
  }
}

export class OAuthAccountConflictError extends Error {
  constructor() {
    super("OAuth account ownership changed during callback processing")
    this.name = "OAuthAccountConflictError"
  }
}
