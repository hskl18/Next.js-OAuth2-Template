"use client"

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { requestPasswordReset } from "../actions"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { passwordResetRequestSchema } from "../schemas"
import Link from "next/link"

export function ForgotPasswordForm() {
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const form = useForm<z.infer<typeof passwordResetRequestSchema>>({
    defaultValues: { email: "" },
  })

  async function onSubmit(data: z.infer<typeof passwordResetRequestSchema>) {
    const result = await requestPasswordReset(data)
    setError(result.ok ? undefined : result.message)
    setNotice(result.ok ? result.message : undefined)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {error && <p className="text-destructive">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex gap-4 justify-end">
          <Button asChild variant="link">
            <Link href="/sign-in">Sign In</Link>
          </Button>
          <Button type="submit">Send Link</Button>
        </div>
      </form>
    </Form>
  )
}
