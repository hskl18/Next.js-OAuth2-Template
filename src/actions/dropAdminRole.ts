"use server"

import { getCurrentUser } from "@/auth/nextjs/currentUser"
import { db } from "@/drizzle/db"
import { UserTable } from "@/drizzle/schema"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export async function dropAdminRole() {
  const user = await getCurrentUser({ redirectIfNotFound: true })

  if (user.role !== "admin") {
    throw new Error("Forbidden")
  }

  const [updatedUser] = await db
    .update(UserTable)
    .set({ role: "user" })
    .where(eq(UserTable.id, user.id))
    .returning({ id: UserTable.id })

  if (updatedUser == null) {
    throw new Error("Failed to drop admin access: user was not updated")
  }

  revalidatePath("/private")
}
