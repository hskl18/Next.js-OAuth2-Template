import { afterEach, describe, expect, it } from "vitest"
import { getClientAddress } from "./requestIdentity"

const originalVercel = process.env.VERCEL

describe("authentication request identity", () => {
  afterEach(() => {
    if (originalVercel == null) delete process.env.VERCEL
    else process.env.VERCEL = originalVercel
  })

  it("does not trust spoofable forwarded headers outside a known proxy", () => {
    delete process.env.VERCEL
    const headers = new Headers({
      "x-forwarded-for": "192.0.2.10",
      "x-real-ip": "192.0.2.11",
      "x-vercel-forwarded-for": "192.0.2.12",
    })

    expect(getClientAddress(headers)).toBe("unknown-client")
  })

  it("accepts Vercel's forwarded client address on Vercel", () => {
    process.env.VERCEL = "1"
    const headers = new Headers({
      "x-vercel-forwarded-for": "192.0.2.12",
    })

    expect(getClientAddress(headers)).toBe("192.0.2.12")
  })
})
