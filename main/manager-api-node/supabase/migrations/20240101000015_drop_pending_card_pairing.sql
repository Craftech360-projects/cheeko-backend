-- Migration: Drop the voice-card pairing session table
-- Description: The self-service "Record a Cheeko Card" flow (upload → open a 60s
--              pairing window → tap a blank card to claim it) has been removed from
--              the Flutter app and replaced by the parent custom-card screen, which
--              keys content by kid_id and lets an admin assign the RFID UID later.
--
--              Zero cards were ever paired through it: rfid_card_mapping has no
--              card_type = 'custom_voice' rows. The only rows here were a single
--              expired 'pending' session, so nothing needs migrating.

DROP TABLE IF EXISTS pending_card_pairing;
