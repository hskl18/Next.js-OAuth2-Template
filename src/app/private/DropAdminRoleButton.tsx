"use client"

import { Button } from "@/components/ui/button"
import { useFormStatus } from "react-dom"

export function DropAdminRoleButton() {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Dropping admin access..." : "Drop admin access"}
    </Button>
  )
}
