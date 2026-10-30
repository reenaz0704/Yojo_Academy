-- Default free plan every new student starts on. Paid plans are created by admins (prices are not in the spec).
INSERT INTO "plans" ("id","code","name","price_paise","currency","features","grants","active","version","updated_at")
VALUES (gen_random_uuid(), 'free', 'Free', 0, 'INR', '{}', '[]', true, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Default CTF event so registration works before admins create events (OPEN ITEM: real event calendar).
INSERT INTO "ctf_events" ("id","name","slug","status","updated_at")
VALUES (gen_random_uuid(), 'Yojo CTF', 'yojo-ctf', 'registration', CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
