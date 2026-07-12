"use client"

import { dropAdminRole } from "@/actions/dropAdminRole"
import { Button } from "@/components/ui/button"

export function DropAdminRoleButton() {
  return <Button onClick={dropAdminRole}>Drop admin access</Button>
}
