-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "cover_file_id" UUID;

-- CreateTable
CREATE TABLE "course_files" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rel_path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "scan_status" TEXT NOT NULL DEFAULT 'pending',
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_files_storage_key_key" ON "course_files"("storage_key");

-- CreateIndex
CREATE INDEX "course_files_course_id_status_idx" ON "course_files"("course_id", "status");

-- AddForeignKey
ALTER TABLE "course_files" ADD CONSTRAINT "course_files_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

