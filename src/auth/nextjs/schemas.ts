import { z } from "zod"

const emailSchema = z.string().trim().toLowerCase().email().max(254)

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
})

export const signUpSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: z.string().min(12).max(128),
})
