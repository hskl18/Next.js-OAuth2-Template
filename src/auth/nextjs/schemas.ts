import { z } from "zod"

const emailSchema = z.string().trim().toLowerCase().email().max(254)

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
})

export const signUpSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
})

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
})

export const setPasswordSchema = z.object({
  // 32 random bytes in base64url
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: z.string().min(12).max(128),
})
