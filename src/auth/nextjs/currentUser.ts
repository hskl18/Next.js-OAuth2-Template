import { cookies } from "next/headers"
import { getUserFromSession } from "../core/session"
import { cache } from "react"
import { redirect } from "next/navigation"
import { db } from "@/drizzle/db"
import { eq } from "drizzle-orm"
import { UserTable } from "@/drizzle/schema"

type User = NonNullable<Awaited<ReturnType<typeof getAuthorizedUser>>>

export function getCurrentUser(options: {
  redirectIfNotFound: true
}): Promise<User>
export function getCurrentUser(options?: {
  redirectIfNotFound?: false
}): Promise<User | null>
export async function getCurrentUser({ redirectIfNotFound = false } = {}) {
  const user = await getAuthorizedUser()
  if (user == null && redirectIfNotFound) return redirect("/sign-in")
  return user
}

// The session only names a user. Role and revocation come from PostgreSQL so a
// role change or sign-out-everywhere applies to every session on its next request.
const getAuthorizedUser = cache(async () => {
  const session = await getUserFromSession(await cookies())
  if (session == null) return null

  const user = await db.query.UserTable.findFirst({
    columns: {
      id: true,
      email: true,
      role: true,
      name: true,
      sessionVersion: true,
    },
    where: eq(UserTable.id, session.id),
  })
  if (user == null || user.sessionVersion !== session.sessionVersion) {
    return null
  }
  return user
})
