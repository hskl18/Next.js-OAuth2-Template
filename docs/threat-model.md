# Threat model

The threats this reference defends against, the control for each, and the tests that show it.
The [README](../README.md) lists what it implements, and [DESIGN.md](../DESIGN.md) explains why.

## Threats and controls

| Threat | Primary control | Evidence |
| --- | --- | --- |
| Login CSRF and callback replay | Random state, PKCE S256, one-time cookie consumption | State mismatch, missing verifier, denial, and replay tests |
| Email-based account takeover | Provider identity first and no email auto-link | Core ownership tests and PostgreSQL integration test |
| Unverified provider email | GitHub verified primary selection and Discord `verified: true` | Provider-specific tests |
| Concurrent callback ownership ambiguity | Transactional inserts and unique provider constraints | Concurrent PostgreSQL integration test |
| Session fixation or unbounded extension | Existing Redis session is revoked before login rotation, and sessions are never rewritten after login | Session rotation and expiration tests |
| Stale privileges or lost revocation across devices | Role and session version come from PostgreSQL per request; sign-out-everywhere increments the version | Current-user, admin page, and sign-out-everywhere tests |
| Provider failure or malicious payload | Five-second timeout, no redirects, status checks, JSON and Zod validation | Provider response tests |
| Brute force and callback abuse | Redis sliding-window limits with hashed identifiers that fail closed when Redis times out or is unreachable | Rate-limit unit tests and Redis integration tests |
| Open redirect through callback parameters | Fixed same-origin destinations only | Callback redirect regression test |
| Pre-registration of someone else's email (pre-account hijacking) | Passwords are set only through a link sent to the mailbox; password sign-in requires a confirmed email; the migration revokes sessions of password accounts created before confirmation existed | Sign-up flow, sign-in, and token integration tests |
| Setup link theft, reuse, or guessing | 256-bit tokens stored as SHA-256, one-hour expiry, atomic single-use delete, one live link per user, `no-referrer` on the link page, form POST instead of GET | Token lifecycle PostgreSQL tests |
| Account enumeration through sign-up or reset | Identical responses whether the email exists, is limited, or fails delivery | Reset response test |

This model assumes PostgreSQL and Redis are trusted application dependencies and that TLS is terminated by the deployment platform.
The implementation trusts Vercel's forwarded client address only when `VERCEL=1`.
Other deployments intentionally share the `unknown-client` bucket until a reviewed trusted-proxy adapter is added.

## Security boundaries and limitations

- Email delivery has only a development console transport; production builds disable sign-up and reset with a visible message until a provider is wired into `src/auth/core/email.ts`.
- Delivery runs before the response, so its latency can hint that an account exists once a real provider is used.
- Password accounts created before email confirmation existed must use Forgot password before they can sign in again.
- There is no MFA, recovery-code flow, account deletion flow, or explicit OAuth account-linking UI.
- Redis availability is required for sessions and authentication rate limits; sign-in, sign-up, and OAuth fail closed while Redis is slow or unreachable.
- Rate limiting is application-level defense in depth and does not replace edge abuse controls.
- Security headers are configured, but a nonce-based Content Security Policy is not yet included.
- Provider tokens are used only for the callback exchange and are not persisted.
- The example has no production deployment, operational monitoring, audit log, incident response automation, or formal security assessment.
- Docker Compose is a local development dependency and is not a production deployment design.
