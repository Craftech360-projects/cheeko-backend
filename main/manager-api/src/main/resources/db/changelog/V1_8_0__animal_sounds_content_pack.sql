-- ============================================================================
-- V1_8_0: Animal Sounds Content Pack for Kids Learning
-- 10 farm and wild animals with sound effects
-- ============================================================================

-- ============================================================================
-- Insert Animal Sounds Content Pack
-- ============================================================================

INSERT INTO rfid_content_pack (pack_code, name, description, content_type, content_md, total_items, language, active, create_date)
VALUES (
    'ANIMALS_EN_01',
    'Animal Sounds',
    'A collection of 10 animal sounds for children - hear how animals sound!',
    'animal',
    '# Animal Sounds Collection

---

## 1. Dog

[cheerfully] Oh, you want to know how a dog sounds? [excited] Here it is!

---

## 2. Cat

[cheerfully] Oh, you want to know how a cat sounds? [excited] Here it is!

---

## 3. Cow

[cheerfully] Oh, you want to know how a cow sounds? [excited] Here it is!

---

## 4. Sheep

[cheerfully] Oh, you want to know how a sheep sounds? [excited] Here it is!

---

## 5. Horse

[cheerfully] Oh, you want to know how a horse sounds? [excited] Here it is!

---

## 6. Pig

[cheerfully] Oh, you want to know how a pig sounds? [excited] Here it is!

---

## 7. Duck

[cheerfully] Oh, you want to know how a duck sounds? [excited] Here it is!

---

## 8. Chicken

[cheerfully] Oh, you want to know how a chicken sounds? [excited] Here it is!

---

## 9. Lion

[cheerfully] Oh, you want to know how a lion sounds? [excited] Here it is!

---

## 10. Elephant

[cheerfully] Oh, you want to know how an elephant sounds? [excited] Here it is!

---

End of Animal Sounds Collection',
    10,
    'en',
    1,
    NOW()
)
ON DUPLICATE KEY UPDATE
    name = 'Animal Sounds',
    description = 'A collection of 10 animal sounds for children - hear how animals sound!',
    content_type = 'animal',
    content_md = '# Animal Sounds Collection

---

## 1. Dog

[cheerfully] Oh, you want to know how a dog sounds? [excited] Here it is!

---

## 2. Cat

[cheerfully] Oh, you want to know how a cat sounds? [excited] Here it is!

---

## 3. Cow

[cheerfully] Oh, you want to know how a cow sounds? [excited] Here it is!

---

## 4. Sheep

[cheerfully] Oh, you want to know how a sheep sounds? [excited] Here it is!

---

## 5. Horse

[cheerfully] Oh, you want to know how a horse sounds? [excited] Here it is!

---

## 6. Pig

[cheerfully] Oh, you want to know how a pig sounds? [excited] Here it is!

---

## 7. Duck

[cheerfully] Oh, you want to know how a duck sounds? [excited] Here it is!

---

## 8. Chicken

[cheerfully] Oh, you want to know how a chicken sounds? [excited] Here it is!

---

## 9. Lion

[cheerfully] Oh, you want to know how a lion sounds? [excited] Here it is!

---

## 10. Elephant

[cheerfully] Oh, you want to know how an elephant sounds? [excited] Here it is!

---

End of Animal Sounds Collection',
    total_items = 10,
    update_date = NOW();

-- ============================================================================
-- Link RFID Card 3DD43A7E to Animal Sounds Content Pack
-- ============================================================================

-- Get the content_pack_id for ANIMALS_EN_01
SET @animals_pack_id = (SELECT id FROM rfid_content_pack WHERE pack_code = 'ANIMALS_EN_01');

-- Insert or update the RFID card mapping
INSERT INTO rfid_card_mapping (rfid_uid, question_id, content_pack_id, pack_code, notes, active, create_date)
VALUES (
    '3DD43A7E',
    NULL,
    @animals_pack_id,
    'ANIMALS_EN_01',
    'Animal sounds card - 10 animals',
    1,
    NOW()
)
ON DUPLICATE KEY UPDATE
    content_pack_id = @animals_pack_id,
    pack_code = 'ANIMALS_EN_01',
    notes = 'Animal sounds card - 10 animals',
    update_date = NOW();
