import { SignInForm } from "@/auth/nextjs/components/SignInForm"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ oauthError?: string; passwordSet?: string }>
}) {
  const { oauthError, passwordSet } = await searchParams
  const hasOAuthError = oauthError === "Failed to connect. Please try again."

  return (
    <div className="container mx-auto p-4 max-w-[750px]">
      <Card>
        <CardHeader>
          <CardTitle>Sign In</CardTitle>
          {hasOAuthError && (
            <CardDescription className="text-destructive">
              Failed to connect. Please try again.
            </CardDescription>
          )}
          {passwordSet === "1" && (
            <CardDescription role="status">
              Password set. Sign in with your new password.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <SignInForm />
        </CardContent>
      </Card>
    </div>
  )
}
