-- Chapter events with RSVPs and contribution tracking, and the jobs & help board.

CREATE TYPE fee_basis AS ENUM ('family', 'person');
CREATE TYPE event_status AS ENUM ('published', 'cancelled');

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(120) NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  venue varchar(200) NOT NULL,
  description text,
  fee_paise integer NOT NULL DEFAULT 0 CHECK (fee_paise >= 0),
  fee_basis fee_basis NOT NULL DEFAULT 'family',
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  status event_status NOT NULL DEFAULT 'published',
  created_by uuid REFERENCES members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_starts_idx ON events (starts_at);

CREATE TABLE event_rsvps (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  guests integer NOT NULL DEFAULT 0 CHECK (guests BETWEEN 0 AND 10),
  paid_paise integer NOT NULL DEFAULT 0 CHECK (paid_paise >= 0),
  paid_recorded_by varchar(120),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, member_id)
);

CREATE TYPE post_type AS ENUM ('job', 'referral', 'help', 'offer', 'mentor');
CREATE TYPE post_status AS ENUM ('open', 'filled', 'closed', 'removed');

CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type post_type NOT NULL,
  title varchar(120) NOT NULL,
  body text NOT NULL,
  organisation varchar(160),
  district varchar(80) NOT NULL,
  state varchar(60) NOT NULL,
  apply_link varchar(300),
  status post_status NOT NULL DEFAULT 'open',
  expires_at timestamptz NOT NULL,
  author_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posts_listing_idx ON posts (status, expires_at, created_at DESC);

CREATE TABLE post_interests (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, member_id)
);

CREATE TYPE report_status AS ENUM ('open', 'dismissed', 'actioned');

CREATE TABLE post_reports (
  id bigserial PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  reason varchar(120) NOT NULL,
  status report_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_reports_once UNIQUE (post_id, member_id)
);

-- Keep the hosting provider's automatic data API (if any) away from these tables too.
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_reports ENABLE ROW LEVEL SECURITY;
