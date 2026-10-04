-- Members can ask for their account to be deleted; an admin then deletes it permanently.
ALTER TABLE members ADD COLUMN deletion_requested_at timestamptz;
ALTER TABLE members ADD COLUMN deletion_note varchar(300);
