import { describe, expect, it } from "vitest"
import { signInSchema, signUpSchema } from "./schemas"

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
      signUpSchema.safeParse({
        name: "Example Person",
        email: "person@example.com",
        password: "x".repeat(129),
      }).success
    ).toBe(false)
  })
})
