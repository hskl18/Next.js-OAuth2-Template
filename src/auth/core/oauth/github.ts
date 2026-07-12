import { env } from "@/data/env/server"
import { OAuthClient } from "./base"
import { z } from "zod"

export function createGithubOAuthClient() {
  const emailSchema = z.array(
    z.object({
      email: z.string().email(),
      primary: z.boolean(),
      verified: z.boolean(),
      visibility: z.string().nullable(),
    })
  )

  return new OAuthClient({
    provider: "github",
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    scopes: ["user:email", "read:user"],
    urls: {
      auth: "https://github.com/login/oauth/authorize",
      token: "https://github.com/login/oauth/access_token",
      user: "https://api.github.com/user",
    },
    userInfo: {
      schema: z.object({
        id: z.number(),
        name: z.string().nullable(),
        login: z.string(),
        email: z.string().email().nullable(),
      }),
      parser: async (user, { fetch }) => {
        const emails = await fetch(
          "https://api.github.com/user/emails",
          emailSchema
        )
        const primaryEmail = emails.find(email => email.primary && email.verified)
        if (primaryEmail == null) throw new UnverifiedGithubEmailError()

        return {
          id: user.id.toString(),
          name: user.name ?? user.login,
          email: primaryEmail.email,
        }
      },
    },
  })
}

class UnverifiedGithubEmailError extends Error {
  constructor() {
    super("GitHub account does not expose a verified primary email")
  }
}
