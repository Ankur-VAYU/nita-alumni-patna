-- Items read automatically from the nita.ac.in home page (Notice Board, Latest News, Upcoming Events),
-- replaced on every successful check, plus the status of the last check.

CREATE TABLE institute_items (
  section varchar(10) NOT NULL CHECK (section IN ('notice', 'news', 'event')),
  position smallint NOT NULL,
  title varchar(400) NOT NULL,
  summary varchar(600),
  link varchar(600) NOT NULL,
  item_date date,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (section, position)
);

CREATE TABLE app_state (
  key varchar(60) PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE institute_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;
