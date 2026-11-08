import { ForgotPasswordForm } from "@/auth/nextjs/components/ForgotPasswordForm"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function ForgotPassword() {
  return (
    <div className="container mx-auto p-4 max-w-[750px]">
      <Card>
        <CardHeader>
          <CardTitle>Forgot Password</CardTitle>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm />
        </CardContent>
      </Card>
    </div>
  )
}
