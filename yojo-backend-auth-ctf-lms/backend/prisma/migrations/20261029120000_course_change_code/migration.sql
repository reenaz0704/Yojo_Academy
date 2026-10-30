-- Readable codes for course change requests (CCR-1001, CCR-1002, ...)
CREATE SEQUENCE "course_change_code_seq" START 1001;
ALTER TABLE "course_change_requests" ALTER COLUMN "code" SET DEFAULT ('CCR-'::text || (nextval('course_change_code_seq'::regclass))::text);
