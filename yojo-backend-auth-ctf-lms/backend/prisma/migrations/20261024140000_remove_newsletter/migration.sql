-- OI-37: the newsletter is removed (owner, 24 Oct). Event reminders keep the table.
DELETE FROM "public_subscriptions" WHERE "kind" = 'newsletter';

-- The scope check compares "kind" with enum literals, so it must go before the type changes.
ALTER TABLE "public_subscriptions" DROP CONSTRAINT public_subscriptions_scope_chk;

-- AlterEnum
BEGIN;
CREATE TYPE "PublicSubscriptionKind_new" AS ENUM ('event_reminder');
ALTER TABLE "public_subscriptions" ALTER COLUMN "kind" TYPE "PublicSubscriptionKind_new" USING ("kind"::text::"PublicSubscriptionKind_new");
ALTER TYPE "PublicSubscriptionKind" RENAME TO "PublicSubscriptionKind_old";
ALTER TYPE "PublicSubscriptionKind_new" RENAME TO "PublicSubscriptionKind";
DROP TYPE "public"."PublicSubscriptionKind_old";
COMMIT;

-- Every row is an event reminder: it names its event, and the scope is that event's id.
ALTER TABLE "public_subscriptions" ADD CONSTRAINT public_subscriptions_scope_chk CHECK (
  "event_id" IS NOT NULL AND "scope" = "event_id"::text
);
