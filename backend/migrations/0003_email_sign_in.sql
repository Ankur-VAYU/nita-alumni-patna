-- Members sign in with Google using the email in their profile, so each email may belong to
-- only one member. Emails are stored lower-case.
UPDATE members SET email = NULLIF(lower(trim(email)), '') WHERE email IS NOT NULL;
CREATE UNIQUE INDEX members_email_key ON members (email) WHERE email IS NOT NULL;
