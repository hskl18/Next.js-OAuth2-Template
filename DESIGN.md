# Design and decisions

This document explains the parts of the sign-in flow that are easy to get wrong, the decision taken for each, and the failures that were found and fixed along the way.
The README covers the threat model, how to run the code, and its limitations.

## Account ownership

A provider email is a claim made by the provider, not proof that two accounts have the same owner.
The callback therefore resolves `(provider, providerAccountId)` first and never links accounts by email.

1. If the provider account is already linked, only its attached local user can sign in.
2. If the provider account is new and its verified email is unused, the callback creates one user and one provider link in a transaction.
3. If the verified email already belongs to a local user, the callback fails with a generic public error.
4. A concurrent insert conflict is re-read from PostgreSQL, and only the database owner of the provider identity is returned.

The ownership rules live in unique constraints on `user_oauth_accounts`, not in application checks, because two callbacks for the same provider account can run at the same time.
`postgresAccountStore.integration.test.ts` runs two such callbacks concurrently and checks that both resolve to one user and one provider link.

GitHub accounts must have a verified primary email from `/user/emails`, and Discord accounts must report `verified: true`.
Explicit account linking is not implemented.
A future linking flow must start from an authenticated local session, require fresh provider authorization, and show a confirmation before committing the link.

## One-time OAuth attempts

Each sign-in attempt stores a random `state` and a PKCE S256 verifier in HttpOnly cookies.
The callback consumes both before it checks anything else, so a replayed or failed callback cannot reuse them.
They are cleared after success, provider denial, malformed callbacks, rate limits, and validation failures.
Provider requests have a five-second timeout, follow no redirects, check status codes, and validate JSON with Zod.

## Sessions and authorization

A session is an opaque random identifier in an HttpOnly SameSite cookie, mapped in Redis to `{ id, sessionVersion, expiresAt }` with an absolute seven-day lifetime.
Every login deletes the previous session before it issues a new identifier.

The session names a user and nothing else that grants access.
`getCurrentUser` reads the role and `sessionVersion` from PostgreSQL on every authorized request and rejects a session whose version is older than the row's.
Sign-out-everywhere and a password reset increment the version, so every other device loses access on its next request.
A login that read version N while a concurrent sign-out-everywhere wrote N+1 issues a session that fails its first check; a race can cost one extra sign-in but cannot restore revoked access.

Protected pages check authorization themselves.
There is no request proxy, because the previous one was both the only gate for `/admin` and a source of session writes (see failures 2 and 3 below).

## Rate limits

Password sign-in, sign-up, password setup emails, OAuth start, and OAuth callback each have their own sliding-window budget in Redis.
Keys are SHA-256 hashes of the scope and identifier, so Redis never stores a raw email.
A limit that cannot be checked rejects the attempt: Redis timeouts and refused connections fail closed.
The client address is trusted from Vercel's forwarded header only when `VERCEL=1`; other deployments share one `unknown-client` bucket until a reviewed trusted-proxy adapter exists.

## Password setup links

Password sign-up first let anyone register an address they did not own and choose its password, which locked the real owner out of their own email.
Verifying the email after sign-up does not fix that: the owner clicking the link would activate the attacker's password.
The chosen design removes the attacker-chosen password instead.

- Sign-up takes only a name and email and creates a passwordless account; sign-up and Forgot password both send the same one-hour link, and only that link can set a password.
- Tokens are 32 random bytes; only their SHA-256 is stored, in a table keyed by user, so issuing a link is an atomic upsert that leaves one live link per user.
- Consumption runs in one transaction that locks the user row, deletes the token by hash as the single-use check, then sets the password, confirms the email, and increments `sessionVersion`.
- `/set-password` renders a form and only its POST consumes the token, so mail scanners that follow the link cannot use it; the page sends `Referrer-Policy: no-referrer`.
- OAuth-only accounts never receive a link, so a mailbox cannot add password access to a provider-owned account.
- Sign-up and reset answer identically whether the email exists, hit its budget, or failed delivery.
- Production builds disable both flows with a visible message, because only a development console transport exists.

Migration `0005` confirms existing OAuth-only accounts and revokes the sessions of existing unconfirmed password accounts, whose passwords may predate any ownership check.

## Failures found and fixed

1. **Role escalation** ([#1](https://github.com/hskl18/Next.js-OAuth2-Template/pull/1)).
   A public Server Action trusted the caller and let a regular user set their own role to admin.
   It was replaced by an admin-only action that can only lower the caller's role, with anonymous, user, and admin tests.
2. **Email-based account takeover** ([#2](https://github.com/hskl18/Next.js-OAuth2-Template/pull/2)).
   The original callback signed in an existing local user whose email matched the OAuth email and ignored conflicting provider-link inserts.
   This produced the provider-first policy and the PostgreSQL constraints above.
3. **Stale admin access on a second device** ([#5](https://github.com/hskl18/Next.js-OAuth2-Template/pull/5)).
   Sessions cached the role in Redis and a role change updated only the requesting session, so another device kept admin access until its session expired.
   Authorization now reads the role from PostgreSQL on each request.
4. **A logged-out session written back** ([#5](https://github.com/hskl18/Next.js-OAuth2-Template/pull/5)).
   The request proxy read and rewrote the session on every request, so a request that read it before a concurrent logout could store it again.
   The proxy and every post-login session write were removed.
5. **Rate limits failing open** ([#6](https://github.com/hskl18/Next.js-OAuth2-Template/pull/6)).
   `@upstash/ratelimit` resolves `success: true` with `reason: "timeout"` when Redis does not answer in time, and the app checked only `success`.
   A unit test now runs the real limiter against a server that never answers and fails without the fix.
6. **Rate limits broken on stock Redis** ([#6](https://github.com/hskl18/Next.js-OAuth2-Template/pull/6)).
   `@upstash/ratelimit` 2.1.0 and later prefix every Lua script with an `allow-key-locking` flag that only Upstash accepts ([upstash/ratelimit-js#162](https://github.com/upstash/ratelimit-js/issues/162)).
   Every unit test passed because Redis was mocked; the new integration tests against Redis 7 failed on every limit call, and the dependency was pinned to 2.0.8.
7. **Verification that activates an attacker's password** ([#7](https://github.com/hskl18/Next.js-OAuth2-Template/pull/7)).
   The first design for email ownership verified the address after a password-bearing sign-up; review showed the victim's click would confirm the attacker's password, which led to the emailed-link design above.
8. **Deadlock between link use and account deletion** ([#7](https://github.com/hskl18/Next.js-OAuth2-Template/pull/7)).
   With the token row locked before the user row, a two-session `psql` check reproduced `deadlock detected` against a user delete, whose cascade locks in the opposite order.
   Consumption now locks the user first, and the same check found no deadlock.
9. **A quick start that did not run** ([#6](https://github.com/hskl18/Next.js-OAuth2-Template/pull/6)).
   `docker compose` read `.env` rather than `.env.local`, and drizzle-kit never loaded `.env.local`.
   Compose now takes `--env-file .env.local`, and `drizzle.config.ts` loads it through `@next/env`.

## Deliberate limits

This is a reference implementation for the ownership, session, and link rules above.
It has no email provider, MFA, recovery codes, account deletion, explicit account linking, nonce-based Content Security Policy, audit log, or production deployment.
Redis is required for sessions and rate limits, and sign-in fails closed while it is slow or unreachable.
