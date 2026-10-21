import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Cookies } from "@/auth/core/session"

const describeWithStores =
  process.env.RUN_DB_INTEGRATION === "1" &&
  process.env.RUN_REDIS_INTEGRATION === "1"
    ? describe
    : describe.skip

// The cookie jar of the device making the current request.
const request = vi.hoisted(() => ({ cookies: undefined as unknown }))

vi.mock("next/headers", () => ({
  cookies: async () => request.cookies,
  headers: async () => new Headers(),
}))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url })
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

class CookieJar implements Cookies {
  private readonly values = new Map<string, string>()

  set(key: string, value: string) {
    this.values.set(key, value)
  }

  get(key: string) {
    const value = this.values.get(key)
    return value == null ? undefined : { name: key, value }
  }

  delete(key: string) {
    this.values.delete(key)
  }
}

describeWithStores("session revocation across PostgreSQL and Redis", () => {
  let dbModule: typeof import("@/drizzle/db")
  let schema: typeof import("@/drizzle/schema")
  let session: typeof import("@/auth/core/session")
  let currentUser: typeof import("./currentUser")
  let actions: typeof import("./actions")
  let dropAdminRole: typeof import("@/actions/dropAdminRole").dropAdminRole

  beforeAll(async () => {
    dbModule = await import("@/drizzle/db")
    schema = await import("@/drizzle/schema")
    session = await import("@/auth/core/session")
    currentUser = await import("./currentUser")
    actions = await import("./actions")
    ;({ dropAdminRole } = await import("@/actions/dropAdminRole"))
  })

  beforeEach(async () => {
    await dbModule.db.delete(schema.UserOAuthAccountTable)
    await dbModule.db.delete(schema.UserTable)
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await dbModule.dbPool.end()
  })

  async function createUser(role: "admin" | "user") {
    const [user] = await dbModule.db
      .insert(schema.UserTable)
      .values({
        name: "Example Person",
        email: "person@example.com",
        role,
        emailVerifiedAt: new Date(),
      })
      .returning({
        id: schema.UserTable.id,
        sessionVersion: schema.UserTable.sessionVersion,
      })
    if (user == null) throw new Error("User insert returned no row")
    return user
  }

  async function signedInDevice(user: { id: string; sessionVersion: number }) {
    const device = new CookieJar()
    await session.createUserSession(user, device)
    return device
  }

  function currentUserOn(device: CookieJar) {
    request.cookies = device
    return currentUser.getCurrentUser()
  }

  it("applies a role downgrade to every device on its next request", async () => {
    const admin = await createUser("admin")
    const deviceA = await signedInDevice(admin)
    const deviceB = await signedInDevice(admin)
    expect((await currentUserOn(deviceB))?.role).toBe("admin")

    request.cookies = deviceA
    await dropAdminRole()

    expect((await currentUserOn(deviceB))?.role).toBe("user")
  })

  it("signs every device out when one device signs out everywhere", async () => {
    const user = await createUser("user")
    const deviceA = await signedInDevice(user)
    const deviceB = await signedInDevice(user)

    request.cookies = deviceB
    await expect(actions.logOutEverywhere()).rejects.toMatchObject({ url: "/" })

    expect(deviceB.get("session-id")).toBeUndefined()
    await expect(currentUserOn(deviceA)).resolves.toBeNull()
    const [row] = await dbModule.db
      .select({ sessionVersion: schema.UserTable.sessionVersion })
      .from(schema.UserTable)
    expect(row?.sessionVersion).toBe(1)
  })

  it("rejects a login that read the version before a concurrent sign-out-everywhere", async () => {
    const user = await createUser("user")
    const deviceA = await signedInDevice(user)
    // A slower login on another device has already read version 0.
    const staleLogin = { id: user.id, sessionVersion: user.sessionVersion }

    request.cookies = deviceA
    await expect(actions.logOutEverywhere()).rejects.toMatchObject({ url: "/" })
    const lateDevice = await signedInDevice(staleLogin)

    await expect(currentUserOn(lateDevice)).resolves.toBeNull()
    const freshDevice = await signedInDevice({ id: user.id, sessionVersion: 1 })
    await expect(currentUserOn(freshDevice)).resolves.toMatchObject({
      id: user.id,
    })
  })

  it("signs every device out when the password is reset", async () => {
    const { issuePasswordSetupToken } = await import(
      "@/auth/core/passwordSetup"
    )
    const user = await createUser("user")
    const deviceA = await signedInDevice(user)
    const deviceB = await signedInDevice(user)
    const token = await issuePasswordSetupToken(user.id)

    await expect(
      actions.setPassword({ token, password: "a brand new password" })
    ).rejects.toMatchObject({ url: "/sign-in?passwordSet=1" })

    await expect(currentUserOn(deviceA)).resolves.toBeNull()
    await expect(currentUserOn(deviceB)).resolves.toBeNull()
  })

  it("signs up through the emailed link and then signs in with the new password", async () => {
    const { redisClient } = await import("@/redis/redis")
    // Every local run shares the unknown-client budget; start it fresh.
    const clientKeys = await redisClient.keys(
      "auth-rate-limit:password-setup-client:*"
    )
    if (clientKeys.length > 0) await redisClient.del(...clientKeys)
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const email = `${crypto.randomUUID()}@example.com`

    await expect(
      actions.signUp({ name: "New Person", email })
    ).resolves.toMatchObject({ ok: true })
    const device = new CookieJar()
    request.cookies = device
    await expect(
      actions.signIn({ email, password: "a brand new password" })
    ).resolves.toBe("Unable to log you in")

    const link = new URL(
      String(info.mock.calls.at(-1)?.[0]).match(/http\S+/)?.[0] ?? ""
    )
    expect(link.pathname).toBe("/set-password")
    await expect(
      actions.setPassword({
        token: link.searchParams.get("token") ?? "",
        password: "a brand new password",
      })
    ).rejects.toMatchObject({ url: "/sign-in?passwordSet=1" })

    await expect(
      actions.signIn({ email, password: "a brand new password" })
    ).rejects.toMatchObject({ url: "/" })
    await expect(currentUserOn(device)).resolves.toMatchObject({ email })
  })
})
