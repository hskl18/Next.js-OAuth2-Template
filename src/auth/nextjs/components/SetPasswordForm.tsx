"use client"

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { setPassword } from "../actions"
import { useForm } from "react-hook-form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useState } from "react"

export function SetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<string>()
  const form = useForm<{ password: string }>({
    defaultValues: { password: "" },
  })

  async function onSubmit({ password }: { password: string }) {
    setError(await setPassword({ token, password }))
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {error && <p className="text-destructive">{error}</p>}
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end">
          <Button type="submit">Set Password</Button>
        </div>
      </form>
    </Form>
  )
}
