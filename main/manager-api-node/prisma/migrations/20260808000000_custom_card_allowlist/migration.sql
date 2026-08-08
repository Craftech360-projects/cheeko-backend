-- custom_card becomes a flat allowlist of issued custom-card UIDs.
-- Custom content is now keyed on the device (rfid_content_pack CUSTOM_<MAC>),
-- so an issued card no longer belongs to a kid and rows are seeded before any
-- kid exists. kid_id stays for the rows already written against it; Postgres
-- allows repeated NULLs under a UNIQUE index, so the constraint can remain.
ALTER TABLE custom_card ALTER COLUMN kid_id DROP NOT NULL;
