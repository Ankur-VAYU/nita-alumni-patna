-- Chapter announcements and NIT Agartala updates, posted by the committee (admins and moderators).

CREATE TYPE news_kind AS ENUM ('chapter', 'institute');

CREATE TABLE announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind news_kind NOT NULL,
  -- For NIT Agartala updates: Admission, Notice, Result, Tender, Event, News.
  tag varchar(30),
  title varchar(160) NOT NULL,
  body text,
  link varchar(500),
  pinned boolean NOT NULL DEFAULT false,
  published_on date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  created_by uuid REFERENCES members(id) ON DELETE SET NULL,
  created_by_label varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX announcements_list_idx ON announcements (kind, pinned DESC, published_on DESC, created_at DESC);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
