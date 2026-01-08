-- ============================================================================
-- V1_6_0: Phonics Content Pack for Kids Learning
-- Complete A-Z letter sounds with ElevenLabs v3 audio tags
-- ============================================================================

-- Make question_id nullable to support content-pack-only cards
ALTER TABLE rfid_card_mapping MODIFY COLUMN question_id BIGINT NULL;

-- ============================================================================
-- Insert Phonics Content Pack
-- ============================================================================

INSERT INTO rfid_content_pack (pack_code, name, description, content_type, content_md, total_items, language, active)
VALUES (
    'PHONICS_EN_01',
    'ABC Phonics Fun',
    'Complete A-Z phonics sounds for early learners with expressive audio',
    'read_only',
    '# 🔤 ABC Phonics Fun - Letter Sounds

---

## 1. Letter A

[cheerfully] A is for Apple!
[slowly][clearly] A says "ah"... "ah"... "ah"
[playfully] Apple, Ant, Alligator - they all start with A!
[excited] Great job learning the letter A!

---

## 2. Letter B

[cheerfully] B is for Ball!
[slowly][clearly] B says "buh"... "buh"... "buh"
[playfully] Ball, Bear, Banana - they all start with B!
[excited] Wonderful! You know the letter B!

---

## 3. Letter C

[cheerfully] C is for Cat!
[slowly][clearly] C says "kuh"... "kuh"... "kuh"
[playfully] Cat, Car, Cookie - they all start with C!
[excited] Amazing! C is so much fun!

---

## 4. Letter D

[cheerfully] D is for Dog!
[slowly][clearly] D says "duh"... "duh"... "duh"
[playfully] Dog, Duck, Dinosaur - they all start with D!
[excited] You''re doing great with D!

---

## 5. Letter E

[cheerfully] E is for Elephant!
[slowly][clearly] E says "eh"... "eh"... "eh"
[playfully] Elephant, Egg, Elf - they all start with E!
[excited] Excellent work on the letter E!

---

## 6. Letter F

[cheerfully] F is for Fish!
[slowly][clearly] F says "fff"... "fff"... "fff"
[playfully] Fish, Frog, Flower - they all start with F!
[excited] Fantastic! You know F!

---

## 7. Letter G

[cheerfully] G is for Grape!
[slowly][clearly] G says "guh"... "guh"... "guh"
[playfully] Grape, Goat, Garden - they all start with G!
[excited] Great job with G!

---

## 8. Letter H

[cheerfully] H is for House!
[slowly][clearly] H says "huh"... "huh"... "huh"
[playfully] House, Hat, Horse - they all start with H!
[excited] Hurray for the letter H!

---

## 9. Letter I

[cheerfully] I is for Igloo!
[slowly][clearly] I says "ih"... "ih"... "ih"
[playfully] Igloo, Insect, Ice cream - they all start with I!
[excited] Incredible! You learned I!

---

## 10. Letter J

[cheerfully] J is for Jelly!
[slowly][clearly] J says "juh"... "juh"... "juh"
[playfully] Jelly, Juice, Jungle - they all start with J!
[excited] Jumping for joy! You know J!

---

## 11. Letter K

[cheerfully] K is for Kite!
[slowly][clearly] K says "kuh"... "kuh"... "kuh"
[playfully] Kite, King, Kangaroo - they all start with K!
[excited] Keep it up! K is cool!

---

## 12. Letter L

[cheerfully] L is for Lion!
[slowly][clearly] L says "lll"... "lll"... "lll"
[playfully] Lion, Lemon, Ladybug - they all start with L!
[excited] Lovely! You''re learning L!

---

## 13. Letter M

[cheerfully] M is for Moon!
[slowly][clearly] M says "mmm"... "mmm"... "mmm"
[playfully] Moon, Monkey, Mango - they all start with M!
[excited] Marvelous work with M!

---

## 14. Letter N

[cheerfully] N is for Nest!
[slowly][clearly] N says "nnn"... "nnn"... "nnn"
[playfully] Nest, Nose, Nut - they all start with N!
[excited] Nice! You''ve got N!

---

## 15. Letter O

[cheerfully] O is for Orange!
[slowly][clearly] O says "ah"... "ah"... "ah"
[playfully] Orange, Octopus, Owl - they all start with O!
[excited] Outstanding! O is awesome!

---

## 16. Letter P

[cheerfully] P is for Penguin!
[slowly][clearly] P says "puh"... "puh"... "puh"
[playfully] Penguin, Pizza, Panda - they all start with P!
[excited] Perfect! You know P!

---

## 17. Letter Q

[cheerfully] Q is for Queen!
[slowly][clearly] Q says "kwuh"... "kwuh"... "kwuh"
[playfully] Queen, Quilt, Question - they all start with Q!
[excited] Quite good! Q is tricky but you got it!

---

## 18. Letter R

[cheerfully] R is for Rainbow!
[slowly][clearly] R says "rrr"... "rrr"... "rrr"
[playfully] Rainbow, Rabbit, Robot - they all start with R!
[excited] Really great work with R!

---

## 19. Letter S

[cheerfully] S is for Snake!
[slowly][clearly] S says "sss"... "sss"... "sss"
[playfully][whispering] Like a snake going sssssss!
[cheerfully] Sun, Star, Strawberry - they all start with S!
[excited] Super! You''re a star with S!

---

## 20. Letter T

[cheerfully] T is for Tiger!
[slowly][clearly] T says "tuh"... "tuh"... "tuh"
[playfully] Tiger, Tree, Turtle - they all start with T!
[excited] Terrific! T is tremendous!

---

## 21. Letter U

[cheerfully] U is for Umbrella!
[slowly][clearly] U says "uh"... "uh"... "uh"
[playfully] Umbrella, Uncle, Up - they all start with U!
[excited] Unbelievable! You know U!

---

## 22. Letter V

[cheerfully] V is for Violin!
[slowly][clearly] V says "vvv"... "vvv"... "vvv"
[playfully] Violin, Van, Vegetable - they all start with V!
[excited] Very good! V is victorious!

---

## 23. Letter W

[cheerfully] W is for Whale!
[slowly][clearly] W says "wuh"... "wuh"... "wuh"
[playfully] Whale, Water, Window - they all start with W!
[excited] Wonderful! W is wow!

---

## 24. Letter X

[cheerfully] X is for X-ray!
[slowly][clearly] X says "ks"... "ks"... "ks"
[playfully] X-ray, Xylophone, Box - X makes the "ks" sound!
[excited] X-cellent! You learned X!

---

## 25. Letter Y

[cheerfully] Y is for Yellow!
[slowly][clearly] Y says "yuh"... "yuh"... "yuh"
[playfully] Yellow, Yak, Yogurt - they all start with Y!
[excited] Yes! You know Y!

---

## 26. Letter Z

[cheerfully] Z is for Zebra!
[slowly][clearly] Z says "zzz"... "zzz"... "zzz"
[playfully][whispering] Like a buzzing bee going zzzzzz!
[cheerfully] Zebra, Zoo, Zipper - they all start with Z!
[excited] Zoom! You finished all the letters!

---

## 🎉 Congratulations!

[excited][cheerfully] Amazing job! You learned all 26 letters of the alphabet!
[proudly] A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y, and Z!
[warmly] Now you know your ABCs, next time won''t you sing with me!

---

✨ End of Phonics Collection',
    26,
    'en',
    1
);

-- ============================================================================
-- Link RFID Card 7AF0CBAD to Phonics Content Pack
-- ============================================================================

-- Get the content_pack_id for PHONICS_EN_01
SET @phonics_pack_id = (SELECT id FROM rfid_content_pack WHERE pack_code = 'PHONICS_EN_01');

-- Insert or update the RFID card mapping
INSERT INTO rfid_card_mapping (rfid_uid, question_id, content_pack_id, pack_code, notes, active, create_date)
VALUES (
    '7AF0CBAD',
    NULL,
    @phonics_pack_id,
    'PHONICS_LEARNING_PACK',
    'ABC Phonics card for early learners',
    1,
    NOW()
)
ON DUPLICATE KEY UPDATE
    content_pack_id = @phonics_pack_id,
    pack_code = 'PHONICS_LEARNING_PACK',
    notes = 'ABC Phonics card for early learners',
    update_date = NOW();
