-- The Wonder Question comes from a bank now, not from the model.
--
-- Every no-repeat guard so far policed the model's OUTPUT: exact-text dedupe,
-- a do-not-repeat list of the last five, an echo guard. All of them were string
-- comparisons with a short memory, and a model with about five stock questions
-- walked straight through: on prod 2026-09-11 it re-asked the food-house
-- question from 2026-09-01 as "make a house" instead of "build a house", the
-- day after that question fell off the five-item list.
--
-- Same cure as the scored questions (ADR-0005): the server picks, the model
-- voices. Selection is a set difference on canonical codes against
-- kid_content_seen, which keeps the child's whole history - no window to fall
-- off, no sentence to paraphrase past. When a child has heard every question
-- the server rotates to the one they heard longest ago, and tells the model so.
--
-- Shaped like why_bank so the admin and the pack installer treat it as one more
-- content bank. No answer column: there is no right answer, that is the point.

CREATE TABLE IF NOT EXISTS "wonder_bank" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "category" VARCHAR(100),
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "question_text" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wonder_bank_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "wonder_bank_code_key" ON "wonder_bank"("code");
CREATE INDEX IF NOT EXISTS "idx_wonder_bank_lang_level" ON "wonder_bank"("language", "level");

-- Which bank question a log row was. Null for the model-invented rows that
-- came before this; those keep their text and stay recallable as before.
ALTER TABLE "kid_wonder_question" ADD COLUMN IF NOT EXISTS "code" VARCHAR(50);

-- Seed. Open questions with no right answer, meant to be HEARD once by a child
-- of four to ten and answered in a sentence. Level 1 is fine for four-year-olds;
-- level 2 leans on a little more imagination. Idempotent on code.
INSERT INTO "wonder_bank" ("code", "level", "category", "question_text") VALUES
  ('WQ-ANIMAL-01', 1, 'animals',   'If you could talk to any animal for one day, which one would you choose?'),
  ('WQ-ANIMAL-02', 1, 'animals',   'If a tiny elephant lived in your house, where would it sleep?'),
  ('WQ-ANIMAL-03', 1, 'animals',   'If you could have any animal as a best friend, which one would you pick?'),
  ('WQ-ANIMAL-04', 2, 'animals',   'If dogs could talk, what do you think they would say first?'),
  ('WQ-ANIMAL-05', 2, 'animals',   'If you were a bird for a day, where would you fly to?'),
  ('WQ-ANIMAL-06', 2, 'animals',   'If a fish could live on land, what would it wear on its feet?'),

  ('WQ-FOOD-01',   1, 'food',      'If you could build a house out of any food, what would you use?'),
  ('WQ-FOOD-02',   1, 'food',      'If it rained one kind of food, what would you want falling from the sky?'),
  ('WQ-FOOD-03',   1, 'food',      'If you could eat only one thing for a whole week, what would it be?'),
  ('WQ-FOOD-04',   2, 'food',      'If you invented a brand new ice cream flavour, what would it taste like?'),
  ('WQ-FOOD-05',   2, 'food',      'If vegetables could talk, which one do you think would be the funniest?'),
  ('WQ-FOOD-06',   2, 'food',      'If you had a magic tiffin box that never got empty, what would be inside?'),

  ('WQ-SPACE-01',  1, 'space',     'If you could visit the moon, what is the first thing you would do there?'),
  ('WQ-SPACE-02',  1, 'space',     'If you had your very own star, what would you name it?'),
  ('WQ-SPACE-03',  2, 'space',     'If you met a friendly alien, what would you show them first on Earth?'),
  ('WQ-SPACE-04',  2, 'space',     'If you could paint the sky any colour you like, what colour would you choose?'),
  ('WQ-SPACE-05',  2, 'space',     'If you could bounce on a cloud, what do you think it would feel like?'),
  ('WQ-SPACE-06',  2, 'space',     'If the sun took a day off, how would you keep everyone warm?'),

  ('WQ-MAGIC-01',  1, 'magic',     'If you had a magic wand for one day, what is the first thing you would do?'),
  ('WQ-MAGIC-02',  1, 'magic',     'If you could have any superpower, which one would you pick?'),
  ('WQ-MAGIC-03',  1, 'magic',     'If you could be invisible for one hour, where would you go?'),
  ('WQ-MAGIC-04',  2, 'magic',     'If your shoes could take you anywhere in the world, where would you walk to?'),
  ('WQ-MAGIC-05',  2, 'magic',     'If you could shrink to the size of an ant, what would you explore first?'),
  ('WQ-MAGIC-06',  2, 'magic',     'If you could make one thing in your house come alive, what would it be?'),

  ('WQ-NATURE-01', 1, 'nature',    'If you could talk to a tree, what would you ask it?'),
  ('WQ-NATURE-02', 1, 'nature',    'If you found a rainbow on the ground, what would you do with it?'),
  ('WQ-NATURE-03', 1, 'nature',    'If you could make it rain or make it sunny, which would you choose today?'),
  ('WQ-NATURE-04', 2, 'nature',    'If you could grow a plant that gives anything you want, what would it grow?'),
  ('WQ-NATURE-05', 2, 'nature',    'If the ocean was made of something other than water, what would you want it to be?'),
  ('WQ-NATURE-06', 2, 'nature',    'If you could be any kind of weather, which weather would you be?'),

  ('WQ-HOME-01',   1, 'home',      'If you could add one new room to your house, what would be in it?'),
  ('WQ-HOME-02',   1, 'home',      'If your bed could fly, where would you take it tonight?'),
  ('WQ-HOME-03',   1, 'home',      'If your toys could talk when you are asleep, what do you think they say?'),
  ('WQ-HOME-04',   2, 'home',      'If you could build a secret hideout, where would you build it?'),
  ('WQ-HOME-05',   2, 'home',      'If your house had a slide instead of stairs, where would it start?'),
  ('WQ-HOME-06',   2, 'home',      'If you could paint your room any colour, what colour would you choose?'),

  ('WQ-PLAY-01',   1, 'play',      'If you could invent a brand new game, what would it be called?'),
  ('WQ-PLAY-02',   1, 'play',      'If you had a robot friend, what would you play together?'),
  ('WQ-PLAY-03',   1, 'play',      'If you could make a playground with anything you want, what would it have?'),
  ('WQ-PLAY-04',   2, 'play',      'If you could be in any cartoon for a day, which one would you pick?'),
  ('WQ-PLAY-05',   2, 'play',      'If you had a hundred balloons, what would you do with them?'),
  ('WQ-PLAY-06',   2, 'play',      'If you could have a party with any animals, which ones would you invite?'),

  ('WQ-BODY-01',   1, 'body',      'If you could have a tail, what kind of tail would you want?'),
  ('WQ-BODY-02',   1, 'body',      'If you could be as tall as a giraffe for a day, what would you do?'),
  ('WQ-BODY-03',   2, 'body',      'If you had wings, what colour would they be?'),
  ('WQ-BODY-04',   2, 'body',      'If you could jump as high as a kangaroo, what would you jump over?'),
  ('WQ-BODY-05',   2, 'body',      'If you had eyes at the back of your head, what would you use them for?'),
  ('WQ-BODY-06',   2, 'body',      'If you could hear as well as a bat, what sound would you want to hear?'),

  ('WQ-VEHICLE-01', 1, 'vehicles', 'If you could drive any vehicle, what would you drive to school?'),
  ('WQ-VEHICLE-02', 1, 'vehicles', 'If you had a boat, where would you sail it?'),
  ('WQ-VEHICLE-03', 2, 'vehicles', 'If you built a rocket from things in your house, what would you use?'),
  ('WQ-VEHICLE-04', 2, 'vehicles', 'If your bicycle could talk, what would it say to you?'),
  ('WQ-VEHICLE-05', 2, 'vehicles', 'If you could ride on the back of any animal, which one would you choose?'),
  ('WQ-VEHICLE-06', 2, 'vehicles', 'If you had a train that went anywhere, what would be the first stop?'),

  ('WQ-FRIEND-01', 1, 'friends',   'If you could give your best friend any present, what would it be?'),
  ('WQ-FRIEND-02', 1, 'friends',   'If you could make a new friend from anywhere in the world, where would they be from?'),
  ('WQ-FRIEND-03', 2, 'friends',   'If you could teach your family one new thing, what would you teach them?'),
  ('WQ-FRIEND-04', 2, 'friends',   'If you could spend a whole day with a grandparent, what would you do?'),
  ('WQ-FRIEND-05', 2, 'friends',   'If you could cook one meal for your family, what would you make?'),
  ('WQ-FRIEND-06', 2, 'friends',   'If a dragon wanted to be your friend, what would you do together?'),

  ('WQ-DREAM-01',  1, 'dreams',    'If you could dream about anything tonight, what would you dream about?'),
  ('WQ-DREAM-02',  1, 'dreams',    'If you could turn into any animal while you sleep, which would you pick?'),
  ('WQ-DREAM-03',  2, 'dreams',    'If you could visit a place from a story you know, which one would you go to?'),
  ('WQ-DREAM-04',  2, 'dreams',    'If your pillow could tell you a story, what would it be about?'),
  ('WQ-DREAM-05',  2, 'dreams',    'If you could have a dream that came true in the morning, what would it be?'),
  ('WQ-DREAM-06',  2, 'dreams',    'If you could stay up all night, what would you want to see?'),

  ('WQ-INVENT-01', 1, 'inventions','If you could invent a machine that does one job, what job would it do?'),
  ('WQ-INVENT-02', 1, 'inventions','If you had a magic pencil that drew real things, what would you draw first?'),
  ('WQ-INVENT-03', 2, 'inventions','If you could make a new kind of toy, what would it do?'),
  ('WQ-INVENT-04', 2, 'inventions','If you invented a new holiday, what would everyone do on that day?'),
  ('WQ-INVENT-05', 2, 'inventions','If you could build a robot to help at home, what would it help with?'),
  ('WQ-INVENT-06', 2, 'inventions','If you could make a new colour that nobody has seen, what would you call it?')
ON CONFLICT ("code") DO NOTHING;
