ALTER TABLE "user_oauth_accounts" DROP CONSTRAINT "user_oauth_accounts_providerAccountId_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "user_oauth_accounts_user_provider_unique" ON "user_oauth_accounts" USING btree ("userId","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_unique" ON "users" USING btree (lower("email"));