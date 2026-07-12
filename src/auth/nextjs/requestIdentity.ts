import { isIP } from "node:net"

export function getClientAddress(headers: Headers) {
  if (process.env.VERCEL !== "1") return "unknown-client"
  const address = headers
    .get("x-vercel-forwarded-for")
    ?.split(",")[0]
    ?.trim()
  if (address != null && isIP(address) !== 0) return address
  return "unknown-client"
}
