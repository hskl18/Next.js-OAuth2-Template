import { SignUpForm } from "@/auth/nextjs/components/SignUpForm"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function SignUp() {
  return (
    <div className="container mx-auto p-4 max-w-[750px]">
      <Card>
        <CardHeader>
          <CardTitle>Sign Up</CardTitle>
        </CardHeader>
        <CardContent>
          <SignUpForm />
        </CardContent>
      </Card>
    </div>
  )
}
