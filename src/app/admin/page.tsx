import { Button } from "@/components/ui/button"
import { getCurrentUser } from "@/auth/nextjs/currentUser"
import Link from "next/link"
import { redirect } from "next/navigation"

export default async function AdminPage() {
  const user = await getCurrentUser({ redirectIfNotFound: true })
  if (user.role !== "admin") redirect("/")

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-4xl mb-8">Admin</h1>
      <Button asChild>
        <Link href="/">Home</Link>
      </Button>
    </div>
  )
}
