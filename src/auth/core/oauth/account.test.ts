import { describe, expect, it } from "vitest"
import {
  AccountLinkRequiredError,
  OAuthAccountConflictError,
  type OAuthAccountStore,
  resolveOAuthLogin,
} from "./account"

const existingUser = { id: "existing-user", sessionVersion: 0 }

describe("OAuth account ownership", () => {
  it("resolves a concurrent callback to the provider account winner", async () => {
    const providerOwner = { id: "provider-owner", sessionVersion: 0 }
    let providerLookupCount = 0
    const store: OAuthAccountStore = {
      findByProviderAccount: async () => {
        providerLookupCount += 1
        return providerLookupCount === 1 ? null : providerOwner
      },
      findByEmail: async () => null,
      createUserWithAccount: async () => {
        throw new OAuthAccountConflictError()
      },
    }

    await expect(
      resolveOAuthLogin(
        {
          provider: "github",
          providerAccountId: "provider-user-42",
          email: "person@example.com",
          name: "Example Person",
        },
        store
      )
    ).resolves.toEqual(providerOwner)
  })

  it("logs in only the user already attached to the provider account", async () => {
    const providerOwner = { id: "provider-owner", sessionVersion: 3 }
    const store: OAuthAccountStore = {
      findByProviderAccount: async () => providerOwner,
      findByEmail: async () => {
        throw new Error("email must not determine an existing provider login")
      },
      createUserWithAccount: async () => {
        throw new Error("must not create")
      },
    }

    await expect(
      resolveOAuthLogin(
        {
          provider: "github",
          providerAccountId: "provider-user-42",
          email: "different-email@example.com",
          name: "Changed Provider Name",
        },
        store
      )
    ).resolves.toEqual(providerOwner)
  })

  it("does not authenticate or auto-link an existing local user by email", async () => {
    const store: OAuthAccountStore = {
      findByProviderAccount: async () => null,
      findByEmail: async () => existingUser,
      createUserWithAccount: async () => {
        throw new Error("must not create")
      },
    }

    await expect(
      resolveOAuthLogin(
        {
          provider: "github",
          providerAccountId: "provider-user-42",
          email: "person@example.com",
          name: "Example Person",
        },
        store
      )
    ).rejects.toBeInstanceOf(AccountLinkRequiredError)
  })
})
