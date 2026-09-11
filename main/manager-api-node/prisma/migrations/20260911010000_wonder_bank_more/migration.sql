-- 100 more Wonder Questions. Same rules as the first 72: open, no right answer,
-- heard once by a child of four to ten, answered in a sentence. Level 1 for the
-- youngest, level 2 leans on a little more imagination. Idempotent on code.
--
-- With 172 in the bank a child who plays every single day hears no repeat for
-- nearly six months, and the second pass after that comes back with what they
-- said the first time.
INSERT INTO "wonder_bank" ("code", "level", "category", "question_text") VALUES
  ('WQ-ANIMAL-07', 1, 'animals',   'If a monkey came to your school for a day, what lesson would it like best?'),
  ('WQ-ANIMAL-08', 1, 'animals',   'If you could be any animal for one day, which one would you be?'),
  ('WQ-ANIMAL-09', 2, 'animals',   'If cats could cook, what do you think they would make for dinner?'),
  ('WQ-ANIMAL-10', 2, 'animals',   'If you could give a lion a job, what job would you give it?'),

  ('WQ-FOOD-07',   1, 'food',      'If you could have a birthday cake shaped like anything, what shape would it be?'),
  ('WQ-FOOD-08',   1, 'food',      'If your favourite snack could grow on a tree, which snack would you plant?'),
  ('WQ-FOOD-09',   2, 'food',      'If you opened a restaurant for animals, what would be on the menu?'),
  ('WQ-FOOD-10',   2, 'food',      'If you could make a dosa as big as a bed, who would you share it with?'),

  ('WQ-SPACE-07',  1, 'space',     'If you could bring one thing back from the moon, what would it be?'),
  ('WQ-SPACE-08',  2, 'space',     'If you had a rocket for one day, which planet would you visit first?'),
  ('WQ-SPACE-09',  2, 'space',     'If the stars could talk to each other at night, what would they say?'),

  ('WQ-MAGIC-07',  1, 'magic',     'If you found a magic hat, what would you want to come out of it?'),
  ('WQ-MAGIC-08',  1, 'magic',     'If you could turn one toy into a real thing, which toy would you choose?'),
  ('WQ-MAGIC-09',  2, 'magic',     'If you had a magic door in your room, where would it open to?'),
  ('WQ-MAGIC-10',  2, 'magic',     'If you could make yourself as big as a house, what would you do first?'),

  ('WQ-NATURE-07', 1, 'nature',    'If you could sit on top of a mountain, what would you look for?'),
  ('WQ-NATURE-08', 2, 'nature',    'If flowers could sing, what kind of song would a sunflower sing?'),
  ('WQ-NATURE-09', 2, 'nature',    'If you could follow a river to the very end, what do you think you would find?'),

  ('WQ-HOME-07',   1, 'home',      'If you could sleep anywhere in your house tonight, where would you choose?'),
  ('WQ-HOME-08',   2, 'home',      'If your house could move like a car, where would you drive it?'),
  ('WQ-HOME-09',   2, 'home',      'If you could keep any animal in your garden, which one would you keep?'),

  ('WQ-PLAY-07',   1, 'play',      'If you could play with a giant version of your favourite toy, what would you do?'),
  ('WQ-PLAY-08',   2, 'play',      'If you could make a new rule for hide and seek, what would it be?'),
  ('WQ-PLAY-09',   2, 'play',      'If you had a swing that went up to the clouds, would you swing on it?'),

  ('WQ-BODY-07',   1, 'body',      'If your hair could change colour every day, what colour would you pick for tomorrow?'),
  ('WQ-BODY-08',   2, 'body',      'If you could run as fast as a cheetah, where would you run to?'),
  ('WQ-BODY-09',   2, 'body',      'If you had a trunk like an elephant, what would you use it for?'),

  ('WQ-VEHICLE-07', 1, 'vehicles', 'If you could ride a scooter that never stopped, where would it take you?'),
  ('WQ-VEHICLE-08', 2, 'vehicles', 'If a bus could fly, where would you want it to land?'),
  ('WQ-VEHICLE-09', 2, 'vehicles', 'If you built a car out of sweets, what would the wheels be made of?'),

  ('WQ-FRIEND-07', 1, 'friends',   'If you could make your friend laugh with one silly thing, what would you do?'),
  ('WQ-FRIEND-08', 2, 'friends',   'If you could go on a trip with your whole family, where would you go?'),
  ('WQ-FRIEND-09', 2, 'friends',   'If a puppy and a kitten both wanted to be your friend, how would you play with both?'),

  ('WQ-DREAM-07',  1, 'dreams',    'If you could fly in your dream tonight, where would you fly first?'),
  ('WQ-DREAM-08',  2, 'dreams',    'If you could meet a character from a cartoon in your dream, who would it be?'),
  ('WQ-DREAM-09',  2, 'dreams',    'If your dream had a colour, what colour would it be?'),

  ('WQ-INVENT-07', 1, 'inventions','If you invented a hat that could do one thing, what would it do?'),
  ('WQ-INVENT-08', 2, 'inventions','If you could build a machine that makes any sound, what sound would it make?'),
  ('WQ-INVENT-09', 2, 'inventions','If you made a new kind of shoe, what would be special about it?'),

  ('WQ-SEASON-01', 1, 'seasons',   'If it could snow in your town for one day, what would you build?'),
  ('WQ-SEASON-02', 1, 'seasons',   'If you could jump in the biggest puddle in the world, would you do it?'),
  ('WQ-SEASON-03', 1, 'seasons',   'If you could have summer holidays all year, what would you do every day?'),
  ('WQ-SEASON-04', 2, 'seasons',   'If the rain was warm and sweet, what would you want it to taste like?'),
  ('WQ-SEASON-05', 2, 'seasons',   'If you could catch the wind in a jar, what would you do with it?'),
  ('WQ-SEASON-06', 2, 'seasons',   'If you could pick the weather for your birthday, what would you pick?'),

  ('WQ-MUSIC-01',  1, 'music',     'If you could play any instrument right now, which one would you play?'),
  ('WQ-MUSIC-02',  1, 'music',     'If your favourite song came alive, what would it look like?'),
  ('WQ-MUSIC-03',  1, 'music',     'If you could make up a dance for elephants, how would it go?'),
  ('WQ-MUSIC-04',  2, 'music',     'If the birds outside your window formed a band, what would they call it?'),
  ('WQ-MUSIC-05',  2, 'music',     'If you could sing a song to make a cloud rain, what would you sing?'),
  ('WQ-MUSIC-06',  2, 'music',     'If you had drums made of anything you like, what would they be made of?'),

  ('WQ-SCHOOL-01', 1, 'school',    'If you could teach the class one thing, what would you teach?'),
  ('WQ-SCHOOL-02', 1, 'school',    'If your school bag could carry anything, what would you put inside?'),
  ('WQ-SCHOOL-03', 1, 'school',    'If you could bring one animal to school, which one would you bring?'),
  ('WQ-SCHOOL-04', 2, 'school',    'If your classroom was in a treehouse, what would be different?'),
  ('WQ-SCHOOL-05', 2, 'school',    'If you could invent a new subject at school, what would it be about?'),
  ('WQ-SCHOOL-06', 2, 'school',    'If your pencil could write on its own, what would you ask it to write?'),

  ('WQ-FEST-01',   1, 'festivals', 'If you could fly a kite as big as a house, what picture would be on it?'),
  ('WQ-FEST-02',   1, 'festivals', 'If you could light up your whole street for a festival, what colours would you use?'),
  ('WQ-FEST-03',   1, 'festivals', 'If you could make a rangoli out of anything, what would you use?'),
  ('WQ-FEST-04',   2, 'festivals', 'If you could invent a new sweet for a festival, what would be inside it?'),
  ('WQ-FEST-05',   2, 'festivals', 'If you could give everyone in your town one gift, what would it be?'),
  ('WQ-FEST-06',   2, 'festivals', 'If you had a festival just for animals, how would they celebrate?'),

  ('WQ-SEA-01',    1, 'sea',       'If you could swim with any sea animal, which one would you choose?'),
  ('WQ-SEA-02',    1, 'sea',       'If you found a treasure chest on the beach, what would you want inside?'),
  ('WQ-SEA-03',    1, 'sea',       'If you could build a sandcastle as tall as you, what would be on top?'),
  ('WQ-SEA-04',    2, 'sea',       'If you could live under the sea for a day, what would your house look like?'),
  ('WQ-SEA-05',    2, 'sea',       'If a whale gave you a ride, where would you ask it to go?'),
  ('WQ-SEA-06',    2, 'sea',       'If you could talk to a dolphin, what would you ask it?'),

  ('WQ-SIZE-01',   1, 'big-small', 'If you were as small as a mouse, where would you hide?'),
  ('WQ-SIZE-02',   1, 'big-small', 'If you were taller than a tree, what could you see?'),
  ('WQ-SIZE-03',   1, 'big-small', 'If you had a giant spoon, what would you eat with it?'),
  ('WQ-SIZE-04',   2, 'big-small', 'If ants were as big as dogs, what would you do with them?'),
  ('WQ-SIZE-05',   2, 'big-small', 'If your house was tiny enough to carry, where would you take it?'),
  ('WQ-SIZE-06',   2, 'big-small', 'If you could shrink one thing to fit in your pocket, what would you shrink?'),

  ('WQ-TIME-01',   1, 'time',      'If you could do your favourite thing from today again, what would it be?'),
  ('WQ-TIME-02',   2, 'time',      'If you could meet yourself when you are grown up, what would you ask?'),
  ('WQ-TIME-03',   2, 'time',      'If a day had one extra hour just for you, what would you do with it?'),
  ('WQ-TIME-04',   2, 'time',      'If you could see the dinosaurs for one minute, what would you look at?'),
  ('WQ-TIME-05',   2, 'time',      'If you could make one day last forever, which day would you choose?'),

  ('WQ-KIND-01',   1, 'kindness',  'If you could do one kind thing for your family tomorrow, what would it be?'),
  ('WQ-KIND-02',   1, 'kindness',  'If you found a lost puppy, how would you help it?'),
  ('WQ-KIND-03',   2, 'kindness',  'If you could make one person smile today, who would it be and how?'),
  ('WQ-KIND-04',   2, 'kindness',  'If you had a hundred rupees to give away, who would you give it to?'),
  ('WQ-KIND-05',   2, 'kindness',  'If you could share your favourite toy with someone, who would you pick?'),

  ('WQ-JOB-01',    1, 'jobs',      'If you could do any job for one day, what would you do?'),
  ('WQ-JOB-02',    1, 'jobs',      'If you were a doctor for animals, which animal would you help first?'),
  ('WQ-JOB-03',    2, 'jobs',      'If you drove a train, what would you say to the passengers?'),
  ('WQ-JOB-04',    2, 'jobs',      'If you were a chef, what would be the name of your special dish?'),
  ('WQ-JOB-05',    2, 'jobs',      'If you were an astronaut, what would you pack for the trip?'),

  ('WQ-BUG-01',    1, 'bugs',      'If a butterfly landed on your nose, what would you say to it?'),
  ('WQ-BUG-02',    1, 'bugs',      'If you could be a bee for a day, which flower would you visit first?'),
  ('WQ-BUG-03',    2, 'bugs',      'If ants built a city, what would they build first?'),
  ('WQ-BUG-04',    2, 'bugs',      'If you could ride on a ladybird, where would you go?'),
  ('WQ-BUG-05',    2, 'bugs',      'If a spider could make a web out of anything, what would you want it to use?'),

  ('WQ-GARDEN-01', 1, 'garden',    'If you could plant one seed and it grew into anything, what would grow?'),
  ('WQ-GARDEN-02', 1, 'garden',    'If you had a tree that grew toys, which toy would you want first?'),
  ('WQ-GARDEN-03', 2, 'garden',    'If you could grow a flower as tall as a building, what colour would it be?'),
  ('WQ-GARDEN-04', 2, 'garden',    'If you could have a garden on the roof, what would you grow there?'),
  ('WQ-GARDEN-05', 2, 'garden',    'If a tree could give you one gift every morning, what would you want?')
ON CONFLICT ("code") DO NOTHING;
