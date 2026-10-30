-- OI-42 (owner, 24 Oct): performance index = attendance 20 %, quiz average 40 %, labs cleared 40 %.
-- The stored policy settings still had the earlier draft weights (attendance/labs/courses/leaderboard); replace them
-- with the new shape, raise the version and record the change like an admin edit would.
INSERT INTO "settings_log" ("id", "section", "by_id", "version", "diff", "created_at")
SELECT gen_random_uuid(), 'policy', NULL, "version" + 1,
       jsonb_build_object('before', "value", 'after', jsonb_set("value", '{piWeights}', '{"attendance": 20, "quiz": 40, "labs": 40}'::jsonb)),
       now()
FROM "settings"
WHERE "section" = 'policy' AND NOT ("value"->'piWeights' ? 'quiz');

UPDATE "settings"
SET "value" = jsonb_set("value", '{piWeights}', '{"attendance": 20, "quiz": 40, "labs": 40}'::jsonb),
    "version" = "version" + 1,
    "updated_at" = now()
WHERE "section" = 'policy' AND NOT ("value"->'piWeights' ? 'quiz');
