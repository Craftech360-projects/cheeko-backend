-- Demo data for the parent app's Week picker (Analytics → Week → ‹ week ›).
--
-- LOCAL DEVELOPMENT DATABASES ONLY. Attaches six weeks of analytics to one
-- existing parent account — the one you sign in to the app with — on that
-- parent's first toy and the child paired to it:
--
--   this week  : a busy week so far
--   last week  : the busiest, crossing a month boundary when there is one
--   2 weeks ago: light
--   3 weeks ago: moderate
--   4 weeks ago: EMPTY on purpose (the picker must show a blank week)
--   5 weeks ago: one short day
--
-- Usage (local Supabase):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v parent_email='you@example.com' -f scripts/dev-seed-week-picker.sql
--
-- Safe to re-run. Days that already hold real rollup rows are left alone
-- (ON CONFLICT DO NOTHING), so real data always wins. Every row this adds is
-- marked and can be removed with the cleanup block at the bottom.

\set ON_ERROR_STOP on
\set marker '''2001-01-01 00:00:00+00'''

BEGIN;

-- The parent, their first toy (a paired one if any) and its child.
CREATE TEMP TABLE wk_target ON COMMIT DROP AS
SELECT u.id AS user_id,
       u.email,
       d.id AS device_id,
       d.mac_address,
       d.kid_id,
       COALESCE(NULLIF(pp.timezone, ''), 'Asia/Kolkata') AS tz
FROM sys_user u
JOIN ai_device d ON d.user_id = u.id
LEFT JOIN parent_profile pp ON pp.user_id = u.id
WHERE lower(u.email) = lower(:'parent_email')
ORDER BY (d.kid_id IS NULL), d.create_date
LIMIT 1;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM wk_target) THEN
        RAISE EXCEPTION 'No toy found for that parent email. Pair a toy to the account first.';
    END IF;
END $$;

-- One row per demo day: weeks back, day of week (0 = Monday), seconds per
-- category, card taps, AI interactions, games played, quiz answers right/wrong.
CREATE TEMP TABLE wk_days ON COMMIT DROP AS
WITH plan (week_back, day_no, game_s, card_s, ai_s, radio_s, taps, ai_n, games, q_right, q_wrong) AS (
    VALUES
    (0, 0, 1200,  600,    0,    0, 4, 0, 2, 2, 1),
    (0, 1,    0,  900,  900,    0, 3, 5, 0, 0, 0),
    (0, 2, 1800,    0,    0, 1200, 0, 0, 3, 3, 0),
    (0, 3,  600,  300,  600,    0, 2, 3, 1, 1, 1),
    (0, 4, 2400,    0,    0,    0, 0, 0, 4, 2, 0),
    (0, 5,    0, 1200,  300,  600, 5, 2, 0, 0, 0),
    (0, 6,  900,    0,    0,    0, 0, 0, 1, 0, 0),
    (1, 0, 1800,  900,    0,    0, 6, 0, 3, 2, 1),
    (1, 1,  600, 1200, 1200,    0, 4, 6, 1, 1, 1),
    (1, 2,    0,    0, 1800,  900, 0, 8, 0, 0, 0),
    (1, 3, 2400,  600,    0,    0, 3, 0, 5, 3, 1),
    (1, 4,  900,    0,  600, 1500, 0, 4, 1, 0, 0),
    (1, 5, 3000, 1800,  900,    0, 7, 3, 4, 2, 2),
    (1, 6, 1200,    0,    0, 2400, 0, 0, 2, 1, 0),
    (2, 1,  600,    0,    0,    0, 1, 0, 1, 1, 1),
    (2, 4,    0,  900,  300,    0, 2, 2, 0, 0, 1),
    (3, 0, 1200,    0,    0,    0, 0, 0, 2, 1, 0),
    (3, 2,    0, 1800,    0,  600, 4, 0, 0, 0, 0),
    (3, 5,  900,    0, 1200,    0, 0, 5, 1, 2, 1),
    (5, 3,    0,    0,    0,  600, 0, 0, 0, 0, 0)
)
SELECT t.*,
       p.*,
       (today.d - (EXTRACT(ISODOW FROM today.d)::int - 1) - 7 * p.week_back + p.day_no) AS day
FROM wk_target t
CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE t.tz)::date AS d) today
CROSS JOIN plan p
-- Nothing is invented for days that have not happened yet.
WHERE (today.d - (EXTRACT(ISODOW FROM today.d)::int - 1) - 7 * p.week_back + p.day_no) <= today.d;

INSERT INTO device_usage_daily (user_id, device_id, mac_address, kid_id, date,
    usage_time_seconds, game_usage_seconds, card_usage_seconds, ai_talk_usage_seconds, radio_usage_seconds,
    created_at, updated_at)
SELECT user_id, device_id, mac_address, kid_id, day,
       game_s + card_s + ai_s + radio_s, game_s, card_s, ai_s, radio_s, :marker, :marker
FROM wk_days
WHERE game_s + card_s + ai_s + radio_s > 0
ON CONFLICT (date, mac_address) DO NOTHING;

INSERT INTO device_card_taps_daily (user_id, device_id, mac_address, kid_id, date, card_tap_count, created_at, updated_at)
SELECT user_id, device_id, mac_address, kid_id, day, taps, :marker, :marker
FROM wk_days WHERE taps > 0
ON CONFLICT (date, mac_address) DO NOTHING;

INSERT INTO device_ai_interactions_daily (user_id, device_id, mac_address, kid_id, date, ai_interaction_count, created_at, updated_at)
SELECT user_id, device_id, mac_address, kid_id, day, ai_n, :marker, :marker
FROM wk_days WHERE ai_n > 0
ON CONFLICT (date, mac_address) DO NOTHING;

-- Plays and answers have no natural key to conflict on, so a re-run first
-- clears this toy's earlier demo rows instead of doubling them.
DELETE FROM device_games_played
WHERE source_event_id = 'demo-week-picker'
  AND mac_address = (SELECT mac_address FROM wk_target);

DELETE FROM quiz_question_answer
WHERE device_mac = (SELECT mac_address FROM wk_target)
  AND question_id IN (SELECT id FROM quiz_question WHERE code LIKE 'DEMOWEEK-%');

INSERT INTO device_games_played (user_id, device_id, mac_address, kid_id, activity_date, game_id, game_name,
    level, difficulty_level, score, duration_ms, played_at, source_device_event_pk, source_event_id)
SELECT w.user_id, w.device_id, w.mac_address, w.kid_id, w.day,
       (ARRAY['SHAPES', 'COLORS', 'NUMBERS'])[1 + (n % 3)],
       (ARRAY['Shapes', 'Colors', 'Numbers'])[1 + (n % 3)],
       (1 + n % 3)::text, (ARRAY['easy', 'medium', 'hard'])[1 + (n % 3)],
       3 + n, 60000 + 15000 * n,
       ((w.day + time '10:00') + n * interval '9 minutes') AT TIME ZONE w.tz,
       gen_random_uuid(), 'demo-week-picker'
FROM wk_days w
CROSS JOIN LATERAL generate_series(0, w.games - 1) AS n
WHERE w.games > 0;

-- Quiz answers need questions to point at. These are inactive, so Quizzy never
-- asks them; they exist only so the Week tab's quiz card has history to show.
INSERT INTO quiz_question (code, question_text, answer_text, level, language, active)
VALUES
    ('DEMOWEEK-01', 'What colour is the sky on a sunny day?', 'blue', 1, 'en', false),
    ('DEMOWEEK-02', 'How many legs does a spider have?', 'eight', 1, 'en', false),
    ('DEMOWEEK-03', 'Which animal says moo?', 'cow', 1, 'en', false),
    ('DEMOWEEK-04', 'What do bees make?', 'honey', 1, 'en', false),
    ('DEMOWEEK-05', 'How many days are in a week?', 'seven', 1, 'en', false),
    ('DEMOWEEK-06', 'What shape has three sides?', 'triangle', 1, 'en', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO quiz_question_answer (device_mac, kid_id, question_id, result, answered_at)
SELECT w.mac_address, w.kid_id, q.id,
       CASE WHEN n < w.q_right THEN 'correct' ELSE 'wrong' END,
       ((w.day + time '17:00') + n * interval '3 minutes') AT TIME ZONE w.tz
FROM wk_days w
CROSS JOIN LATERAL generate_series(0, w.q_right + w.q_wrong - 1) AS n
JOIN quiz_question q ON q.code = 'DEMOWEEK-0' || (1 + (n % 6))
WHERE w.q_right + w.q_wrong > 0;

-- Who this was seeded for, and what each week now holds for that toy.
SELECT t.email, u.firebase_uid, t.mac_address, t.kid_id, k.name AS child, t.tz AS timezone
FROM wk_target t
JOIN sys_user u ON u.id = t.user_id
LEFT JOIN kid_profile k ON k.id = t.kid_id;

SELECT date_trunc('week', u.date)::date AS week_start,
       SUM(u.usage_time_seconds) / 60 AS minutes,
       COUNT(*) AS active_days
FROM device_usage_daily u
JOIN wk_target t ON t.mac_address = u.mac_address
WHERE u.date >= (SELECT MIN(day) FROM wk_days)
GROUP BY 1
ORDER BY 1 DESC;

COMMIT;

-- Cleanup — removes only what this script added:
-- DELETE FROM quiz_question_answer WHERE question_id IN (SELECT id FROM quiz_question WHERE code LIKE 'DEMOWEEK-%');
-- DELETE FROM quiz_question WHERE code LIKE 'DEMOWEEK-%';
-- DELETE FROM device_games_played WHERE source_event_id = 'demo-week-picker';
-- DELETE FROM device_usage_daily WHERE created_at = '2001-01-01 00:00:00+00';
-- DELETE FROM device_card_taps_daily WHERE created_at = '2001-01-01 00:00:00+00';
-- DELETE FROM device_ai_interactions_daily WHERE created_at = '2001-01-01 00:00:00+00';
