import { LogOutButton } from "@/auth/nextjs/components/LogOutButton"
import { getCurrentUser } from "@/auth/nextjs/currentUser"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import Link from "next/link"

export default async function HomePage() {
  const fullUser = await getCurrentUser({ withFullUser: true })

  return (
    <div className="container mx-auto p-4">
      {fullUser == null ? (
        <div className="flex gap-4">
          <Button asChild>
            <Link href="/sign-in">Sign In</Link>
          </Button>
          <Button asChild>
            <Link href="/sign-up">Sign Up</Link>
          </Button>
        </div>
      ) : (
        <Card className="max-w-[500px] mt-4">
          <CardHeader>
            <CardTitle>User: {fullUser.name}</CardTitle>
            <CardDescription>Role: {fullUser.role}</CardDescription>
          </CardHeader>
          <CardFooter className="flex gap-4">
            <Button asChild variant="outline">
              <Link href="/private">Private Page</Link>
            </Button>
            {fullUser.role === "admin" && (
              <Button asChild variant="outline">
                <Link href="/admin">Admin Page</Link>
              </Button>
            )}
            <LogOutButton />
          </CardFooter>
        </Card>
      )}
    </div>
  )
}
