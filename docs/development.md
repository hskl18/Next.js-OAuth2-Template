# Development and verification

How to run the full test suite, the checks to run before a pull request, why some dependencies are pinned, and where the code lives.

## Integration tests

Start from the local setup in the README's [Run it](../README.md#run-it) section, so `.env.local`, the dependencies, and the Compose services are in place.
To run the full suite, including the integration tests, against a separate database (they delete every user):

```bash
docker compose --env-file .env.local exec db createdb -U postgres oauth_template_test
set -a; source .env.local; set +a
export DB_NAME=oauth_template_test RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1
npm run db:migrate
npm test
```

Without `RUN_DB_INTEGRATION` and `RUN_REDIS_INTEGRATION`, `npm test` runs the 58 tests that need neither service.

## Checks

Type checking uses TypeScript 7 through the `@typescript/native` npm alias.
The `typescript` alias supplies Microsoft's TypeScript 6 compatibility API for Next.js and typescript-eslint, following the [official side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0).
ESLint stays on 9.39.5 because the React, accessibility, and import plugins used by `eslint-config-next` do not yet declare ESLint 10 support.
`@upstash/ratelimit` stays on 2.0.8 because 2.1.0 and later prefix every Lua script with an Upstash-only `allow-key-locking` flag that stock Redis rejects ([upstash/ratelimit-js#162](https://github.com/upstash/ratelimit-js/issues/162)).
`npm run typecheck` generates Next.js route types before checking a fresh checkout.

```bash
npm audit --audit-level=low
npm run lint
npm run typecheck
npm test
npm run build
```

CI runs all of these except `npm audit`, which is a local check.

`RUN_DB_INTEGRATION=1` enables the PostgreSQL tests, and `RUN_REDIS_INTEGRATION=1` enables the Redis tests; the session-revocation tests need both.
GitHub Actions starts PostgreSQL 17, Redis 7, and serverless-redis-http, applies the generated migrations, sets both flags, and runs the whole suite.

The test matrix covers:

- state mismatch and one-time cookie deletion
- missing or reused PKCE verifier
- callback replay and provider denial
- null GitHub public email and verified primary selection
- unverified GitHub and Discord email
- provider account already linked to another local user
- existing local user with a matching email
- concurrent provider callbacks
- session rotation and absolute expiration
- database role and session version override stale sessions
- server-side admin page authorization
- sign-out-everywhere revocation
- callback open-redirect attempts
- hashed Redis rate-limit identifiers and per-scope budgets against real Redis
- rate limits failing closed on Redis timeout and connection refusal
- Redis session TTL, rotation, logout deletion, and rejection of pre-version sessions
- role downgrade and sign-out-everywhere across two devices against PostgreSQL and Redis
- concurrent use of one setup link, concurrent issuance, expiry, replacement, and cascade deletion
- OAuth-only accounts receiving no setup link
- password reset signing out every device
- sign-up through the emailed link followed by password sign-in
- a login that read the session version before a concurrent sign-out-everywhere
- role downgrade authorization from the earlier hardening pass

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/auth/core/oauth/base.ts` | One-time OAuth attempt handling and bounded provider requests |
| `src/auth/core/oauth/account.ts` | Provider-first account ownership policy |
| `src/auth/core/oauth/postgresAccountStore.ts` | Transactional PostgreSQL adapter |
| `src/auth/core/session.ts` | Opaque Redis sessions and login rotation |
| `src/auth/nextjs/currentUser.ts` | Per-request authorization from the database row |
| `src/auth/core/rateLimit.ts` | Hashed Redis rate-limit keys and policy |
| `src/auth/core/passwordSetup.ts` | Emailed password setup links for sign-up and reset |
| `src/app/api/oauth/[provider]/route.ts` | OAuth callback boundary |
| `src/drizzle/schema.ts` | User, provider-account, and setup-token constraints |
| `DESIGN.md` | Decisions, hard parts, and failures found and fixed |
