import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip

describeWithDatabase("PostgreSQL OAuth account ownership", () => {
  let dbModule: typeof import("@/drizzle/db")
  let schema: typeof import("@/drizzle/schema")
  let account: typeof import("./account")
  let store: InstanceType<
    typeof import("./postgresAccountStore").PostgresOAuthAccountStore
  >

  beforeAll(async () => {
    dbModule = await import("@/drizzle/db")
    schema = await import("@/drizzle/schema")
    account = await import("./account")
    const { PostgresOAuthAccountStore } = await import(
      "./postgresAccountStore"
    )
    store = new PostgresOAuthAccountStore()
  })

  beforeEach(async () => {
    await dbModule.db.delete(schema.UserOAuthAccountTable)
    await dbModule.db.delete(schema.UserTable)
  })

  afterAll(async () => {
    await dbModule.dbPool.end()
  })

  it("does not attach a new provider identity to an existing local email", async () => {
    await dbModule.db.insert(schema.UserTable).values({
      name: "Existing Local User",
      email: "person@example.com",
      password: "example-hash",
      salt: "example-salt",
    })

    await expect(
      account.resolveOAuthLogin(
        {
          provider: "github",
          providerAccountId: "provider-user-42",
          email: "person@example.com",
          name: "Provider User",
        },
        store
      )
    ).rejects.toBeInstanceOf(account.AccountLinkRequiredError)
    expect(
      await dbModule.db.select().from(schema.UserOAuthAccountTable)
    ).toHaveLength(0)
  })

  it("converges concurrent callbacks on one provider account owner", async () => {
    const identity = {
      provider: "github" as const,
      providerAccountId: "provider-user-42",
      email: "person@example.com",
      name: "Example Person",
    }

    const [first, second] = await Promise.all([
      account.resolveOAuthLogin(identity, store),
      account.resolveOAuthLogin(identity, store),
    ])

    expect(first.id).toBe(second.id)
    expect(await dbModule.db.select().from(schema.UserTable)).toHaveLength(1)
    expect(
      await dbModule.db.select().from(schema.UserOAuthAccountTable)
    ).toHaveLength(1)
  })
})
