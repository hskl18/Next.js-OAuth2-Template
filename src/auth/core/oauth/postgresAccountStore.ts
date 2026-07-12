import { db } from "@/drizzle/db"
import {
  UserOAuthAccountTable,
  UserTable,
  type OAuthProvider,
} from "@/drizzle/schema"
import { and, eq, sql } from "drizzle-orm"
import {
  OAuthAccountConflictError,
  type OAuthAccountStore,
  type VerifiedOAuthIdentity,
} from "./account"

export class PostgresOAuthAccountStore implements OAuthAccountStore {
  async findByProviderAccount(
    provider: OAuthProvider,
    providerAccountId: string
  ) {
    const account = await db.query.UserOAuthAccountTable.findFirst({
      where: and(
        eq(UserOAuthAccountTable.provider, provider),
        eq(UserOAuthAccountTable.providerAccountId, providerAccountId)
      ),
      with: {
        user: {
          columns: { id: true, role: true },
        },
      },
    })
    return account?.user ?? null
  }

  async findByEmail(email: string) {
    return (
      (await db.query.UserTable.findFirst({
        where: eq(sql`lower(${UserTable.email})`, email),
        columns: { id: true, role: true },
      })) ?? null
    )
  }

  async createUserWithAccount(identity: VerifiedOAuthIdentity) {
    try {
      return await db.transaction(async trx => {
        const [user] = await trx
          .insert(UserTable)
          .values({
            email: identity.email,
            name: identity.name,
          })
          .returning({ id: UserTable.id, role: UserTable.role })
        if (user == null) throw new Error("User insert returned no row")

        await trx.insert(UserOAuthAccountTable).values({
          provider: identity.provider,
          providerAccountId: identity.providerAccountId,
          userId: user.id,
        })
        return user
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw new OAuthAccountConflictError()
      throw error
    }
  }
}

export const oauthAccountStore = new PostgresOAuthAccountStore()

function isUniqueViolation(error: unknown): boolean {
  let current = error
  for (let depth = 0; depth < 4 && current != null; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      current.code === "23505"
    ) {
      return true
    }
    current =
      typeof current === "object" && "cause" in current
        ? current.cause
        : undefined
  }
  return false
}
