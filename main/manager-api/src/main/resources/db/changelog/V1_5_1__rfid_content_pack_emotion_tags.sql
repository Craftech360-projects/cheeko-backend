-- ============================================================================
-- V1_5_1: Update RFID Content Pack with ElevenLabs v3 Audio Tags
-- Adds emotional expression tags for engaging kids' content
-- ============================================================================

UPDATE rfid_content_pack
SET content_md = '# 🌟 Classic Nursery Rhymes Collection

---

## 1. Twinkle Twinkle Little Star

[softly][dreamily] Twinkle, twinkle, little star,
How I wonder what you are!
[looking up in wonder] Up above the world so high,
Like a diamond in the sky.

[gently] Twinkle, twinkle, little star,
How I wonder what you are!

---

## 2. Humpty Dumpty Sat on a Wall

[cheerfully] Humpty Dumpty sat on a wall,
[dramatically] Humpty Dumpty had a great fall!
[concerned] All the king''s horses and all the king''s men
[sadly] Couldn''t put Humpty together again.

---

## 3. Incy Wincy Spider

[playfully] Incy Wincy spider climbed up the water spout,
[dramatically] Down came the rain and washed the spider out!
[happily] Out came the sunshine and dried up all the rain,
[cheerfully] And Incy Wincy spider climbed up the spout again!

---

## 4. Row Row Row Your Boat

[rhythmically][happily] Row, row, row your boat,
[gently] Gently down the stream.
[cheerfully] Merrily, merrily, merrily, merrily,
[dreamily] Life is but a dream.

---

## 5. Mary Had a Little Lamb

[sweetly] Mary had a little lamb,
Its fleece was white as snow;
[playfully] And everywhere that Mary went,
The lamb was sure to go.

[mischievously] It followed her to school one day,
Which was against the rule;
[laughs] It made the children laugh and play
To see a lamb at school!

---

## 6. Hickory Dickory Dock

[excitedly] Hickory dickory dock,
[whispers] The mouse ran up the clock.
[loudly] The clock struck one!
[quickly] The mouse ran down,
[cheerfully] Hickory dickory dock!

---

## 7. Jack and Jill Went Up the Hill

[cheerfully] Jack and Jill went up the hill
To fetch a pail of water.
[gasps] Jack fell down and broke his crown,
[concerned] And Jill came tumbling after!

[relieved] Up Jack got and home did trot,
As fast as he could caper;
[gently] Went to bed to mend his head
With vinegar and brown paper.

---

## 8. Itsy Bitsy Spider

[playfully] The itsy bitsy spider climbed up the waterspout,
[dramatically] Down came the rain and washed the spider out!
[happily] Out came the sun and dried up all the rain,
[triumphantly] And the itsy bitsy spider climbed up the spout again!

---

## 9. Hey Diddle Diddle

[excitedly] Hey diddle diddle,
[playfully] The cat and the fiddle,
[amazed] The cow jumped over the moon!
[laughs] The little dog laughed
To see such sport,
[mischievously] And the dish ran away with the spoon!

---

## 10. London Bridge Is Falling Down

[dramatically] London Bridge is falling down,
Falling down, falling down,
[concerned] London Bridge is falling down,
My fair lady.

[hopefully] Build it up with silver and gold,
Silver and gold, silver and gold,
[cheerfully] Build it up with silver and gold,
My fair lady!

---

✨ End of Collection',
update_date = NOW()
WHERE pack_code = 'RHYMES_EN_01';
