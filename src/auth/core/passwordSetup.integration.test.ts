import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip

describeWithDatabase("PostgreSQL password setup tokens", () => {
  let dbModule: typeof import("@/drizzle/db")
  let schema: typeof import("@/drizzle/schema")
  let setup: typeof import("./passwordSetup")
  let drizzle: typeof import("drizzle-orm")

  beforeAll(async () => {
    dbModule = await import("@/drizzle/db")
    schema = await import("@/drizzle/schema")
    setup = await import("./passwordSetup")
    drizzle = await import("drizzle-orm")
  })

  beforeEach(async () => {
    await dbModule.db.delete(schema.UserOAuthAccountTable)
    await dbModule.db.delete(schema.UserTable)
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await dbModule.dbPool.end()
  })

  async function createUser(values: { password?: string; salt?: string } = {}) {
    const [user] = await dbModule.db
      .insert(schema.UserTable)
      .values({ name: "Example Person", email: "person@example.com", ...values })
      .returning({ id: schema.UserTable.id })
    if (user == null) throw new Error("User insert returned no row")
    return user
  }

  function readUser(id: string) {
    return dbModule.db.query.UserTable.findFirst({
      where: drizzle.eq(schema.UserTable.id, id),
    })
  }

  const credentials = { password: "new-hash", salt: "new-salt" }

  it("lets only one of two concurrent requests use a link", async () => {
    const user = await createUser()
    const token = await setup.issuePasswordSetupToken(user.id)

    const results = await Promise.all([
      setup.consumePasswordSetupToken(token, credentials),
      setup.consumePasswordSetupToken(token, credentials),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect((await readUser(user.id))?.sessionVersion).toBe(1)
  })

  it("sets the password, confirms the email, and revokes sessions in one step", async () => {
    const user = await createUser()
    const token = await setup.issuePasswordSetupToken(user.id)

    await expect(
      setup.consumePasswordSetupToken(token, credentials)
    ).resolves.toBe(true)

    expect(await readUser(user.id)).toMatchObject({
      password: "new-hash",
      salt: "new-salt",
      sessionVersion: 1,
      emailVerifiedAt: expect.any(Date),
    })
    expect(
      await dbModule.db.select().from(schema.PasswordSetupTokenTable)
    ).toHaveLength(0)
    await expect(setup.isPasswordSetupTokenLive(token)).resolves.toBe(false)
  })

  it("invalidates the previous link when a new one is issued", async () => {
    const user = await createUser()
    const first = await setup.issuePasswordSetupToken(user.id)
    const second = await setup.issuePasswordSetupToken(user.id)

    await expect(setup.isPasswordSetupTokenLive(first)).resolves.toBe(false)
    await expect(
      setup.consumePasswordSetupToken(first, credentials)
    ).resolves.toBe(false)
    await expect(
      setup.consumePasswordSetupToken(second, credentials)
    ).resolves.toBe(true)
  })

  it("leaves exactly one live link after concurrent issuance", async () => {
    const user = await createUser()
    const tokens = await Promise.all([
      setup.issuePasswordSetupToken(user.id),
      setup.issuePasswordSetupToken(user.id),
      setup.issuePasswordSetupToken(user.id),
    ])

    const live = await Promise.all(tokens.map(setup.isPasswordSetupTokenLive))
    expect(live.filter(Boolean)).toHaveLength(1)
  })

  it("rejects an expired link", async () => {
    const user = await createUser()
    const token = await setup.issuePasswordSetupToken(user.id)
    await dbModule.db
      .update(schema.PasswordSetupTokenTable)
      .set({ expiresAt: drizzle.sql`now() - interval '1 second'` })

    await expect(
      setup.consumePasswordSetupToken(token, credentials)
    ).resolves.toBe(false)
    expect((await readUser(user.id))?.password).toBeNull()
  })

  it("emails pending and password accounts but never OAuth-only accounts", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const pending = await createUser()
    await setup.sendPasswordSetupLink("person@example.com")
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("/set-password?token=")
    )

    await dbModule.db.delete(schema.UserTable)
    await createUser({ password: "existing-hash", salt: "existing-salt" })
    info.mockClear()
    await setup.sendPasswordSetupLink("person@example.com")
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("/set-password?token=")
    )

    await dbModule.db.delete(schema.UserTable)
    const oauthOnly = await createUser()
    await dbModule.db.insert(schema.UserOAuthAccountTable).values({
      userId: oauthOnly.id,
      provider: "github",
      providerAccountId: "provider-user-42",
    })
    info.mockClear()
    await setup.sendPasswordSetupLink("person@example.com")

    expect(info).not.toHaveBeenCalled()
    expect(
      await dbModule.db.select().from(schema.PasswordSetupTokenTable)
    ).toHaveLength(0)
    expect(pending.id).not.toBe(oauthOnly.id)
  })

  it("deletes outstanding links with their user", async () => {
    const user = await createUser()
    await setup.issuePasswordSetupToken(user.id)

    await dbModule.db
      .delete(schema.UserTable)
      .where(drizzle.eq(schema.UserTable.id, user.id))

    expect(
      await dbModule.db.select().from(schema.PasswordSetupTokenTable)
    ).toHaveLength(0)
  })
})
