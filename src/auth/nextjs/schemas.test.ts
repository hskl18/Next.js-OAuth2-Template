import { describe, expect, it } from "vitest"
import { setPasswordSchema, signInSchema } from "./schemas"

describe("authentication input schemas", () => {
  it("normalizes email identity consistently", () => {
    expect(
      signInSchema.parse({
        email: "  Person@Example.COM ",
        password: "a valid password",
      }).email
    ).toBe("person@example.com")
  })

  it("rejects passwords large enough to amplify hashing cost", () => {
    expect(
      setPasswordSchema.safeParse({
        token: "a".repeat(43),
        password: "x".repeat(129),
      }).success
    ).toBe(false)
  })

  it("accepts only the 32-byte base64url setup token shape", () => {
    const password = "a valid password"
    expect(
      setPasswordSchema.safeParse({ token: "A-_".repeat(14) + "z", password })
        .success
    ).toBe(true)
    expect(
      setPasswordSchema.safeParse({ token: "a".repeat(44), password }).success
    ).toBe(false)
    expect(
      setPasswordSchema.safeParse({ token: "a".repeat(42) + "=", password })
        .success
    ).toBe(false)
  })
})
