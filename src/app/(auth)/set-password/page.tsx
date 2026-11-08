import { SetPasswordForm } from "@/auth/nextjs/components/SetPasswordForm"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// Rendering never consumes the token; only submitting the form does, so mail
// scanners that follow the link cannot use it up.
export default async function SetPassword({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  return (
    <div className="container mx-auto p-4 max-w-[750px]">
      <Card>
        <CardHeader>
          <CardTitle>Set Password</CardTitle>
          {token == null && (
            <CardDescription className="text-destructive">
              This link is invalid or has expired.
            </CardDescription>
          )}
        </CardHeader>
        {token != null && (
          <CardContent>
            <SetPasswordForm token={token} />
          </CardContent>
        )}
      </Card>
    </div>
  )
}
