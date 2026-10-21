-- OAuth-only accounts belong to a provider identity and never receive a
-- password setup link, so marking their email confirmed grants nothing new.
UPDATE "users" SET "emailVerifiedAt" = "createdAt"
WHERE "emailVerifiedAt" IS NULL
  AND "password" IS NULL
  AND "id" IN (SELECT "userId" FROM "user_oauth_accounts");
--> statement-breakpoint
-- A password chosen before confirmation existed may belong to whoever
-- pre-registered the email: revoke its sessions until the mailbox holder resets it.
UPDATE "users" SET "sessionVersion" = "sessionVersion" + 1
WHERE "emailVerifiedAt" IS NULL
  AND "password" IS NOT NULL;
