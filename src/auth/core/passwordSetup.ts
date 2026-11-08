import crypto from "node:crypto"
import { and, eq, gt, sql } from "drizzle-orm"
import { env } from "@/data/env/server"
import { db } from "@/drizzle/db"
import { PasswordSetupTokenTable, UserTable } from "@/drizzle/schema"
import { sendAuthEmail } from "./email"

// Sign-up and password reset share this flow: only the mailbox holder ever
// chooses a password, so a pre-registered email cannot carry an attacker's.
export async function sendPasswordSetupLink(email: string) {
  const user = await db.query.UserTable.findFirst({
    columns: { id: true, email: true, password: true },
    where: eq(sql`lower(${UserTable.email})`, email),
    with: { oAuthAccounts: { columns: { provider: true }, limit: 1 } },
  })
  // OAuth-only accounts never gain mailbox-based password access.
  if (user == null || (user.password == null && user.oAuthAccounts.length > 0)) {
    return
  }

  const token = await issuePasswordSetupToken(user.id)
  // The configured public origin, never a request-derived host.
  const link = new URL("/set-password", env.OAUTH_REDIRECT_URL_BASE)
  link.searchParams.set("token", token)
  // shortcut: delivery runs before the response, so its latency can hint that
  // the account exists; move it to after() or an outbox with a real provider.
  await sendAuthEmail({
    to: user.email,
    subject: "Set your password",
    text: `Use this link within one hour to set your password:\n\n${link}\n\nIf you did not ask for this, ignore this email.`,
  })
}

export async function issuePasswordSetupToken(userId: string) {
  const token = crypto.randomBytes(32).toString("base64url")
  const tokenHash = hashToken(token)
  const expiresAt = sql`now() + interval '1 hour'`
  // The upsert replaces any outstanding link atomically, so concurrent
  // requests leave exactly one valid token.
  await db
    .insert(PasswordSetupTokenTable)
    .values({ userId, tokenHash, expiresAt })
    .onConflictDoUpdate({
      target: PasswordSetupTokenTable.userId,
      set: { tokenHash, expiresAt, createdAt: sql`now()` },
    })
  return token
}

// Lets callers reject unknown links before paying for scrypt.
export async function isPasswordSetupTokenLive(token: string) {
  const row = await db.query.PasswordSetupTokenTable.findFirst({
    columns: { userId: true },
    where: liveToken(token),
  })
  return row != null
}

export async function consumePasswordSetupToken(
  token: string,
  credentials: { password: string; salt: string }
) {
  return db.transaction(async trx => {
    // Lock the user before the token, the order a user delete's cascade uses,
    // so consumption and deletion cannot deadlock.
    const [owner] = await trx
      .select({ id: UserTable.id })
      .from(UserTable)
      .innerJoin(
        PasswordSetupTokenTable,
        eq(PasswordSetupTokenTable.userId, UserTable.id)
      )
      .where(liveToken(token))
      .for("update", { of: UserTable })
    if (owner == null) return false

    // Deleting by hash is the single-use check: a concurrent caller that waited
    // on the lock finds the row gone.
    const [consumed] = await trx
      .delete(PasswordSetupTokenTable)
      .where(
        and(liveToken(token), eq(PasswordSetupTokenTable.userId, owner.id))
      )
      .returning({ userId: PasswordSetupTokenTable.userId })
    if (consumed == null) return false

    const [user] = await trx
      .update(UserTable)
      .set({
        ...credentials,
        emailVerifiedAt: sql`coalesce(${UserTable.emailVerifiedAt}, now())`,
        sessionVersion: sql`${UserTable.sessionVersion} + 1`,
      })
      .where(eq(UserTable.id, consumed.userId))
      .returning({ id: UserTable.id })
    if (user == null) throw new Error("Password setup user was not updated")
    return true
  })
}

function liveToken(token: string) {
  return and(
    eq(PasswordSetupTokenTable.tokenHash, hashToken(token)),
    gt(PasswordSetupTokenTable.expiresAt, sql`now()`)
  )
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex")
}
