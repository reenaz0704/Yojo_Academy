-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "co_editor_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "publish_request_note" TEXT,
ADD COLUMN     "publish_requested_at" TIMESTAMPTZ(6),
ADD COLUMN     "publish_requested_by_id" UUID;

