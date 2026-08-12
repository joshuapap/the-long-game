-- The Long Game — schema. SQLite (node:sqlite).
-- Money is modelled in integer cents. reward_mode lets a comp run non-cash
-- (bragging rights) or cash (a real pot) on the same plumbing.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_color TEXT DEFAULT '#7C6BE0',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Subscription plans. Entitlements gate how much a commissioner can run.
CREATE TABLE IF NOT EXISTS plans (
  id           TEXT PRIMARY KEY,          -- 'free' | 'club' | 'league'
  name         TEXT NOT NULL,
  price_cents  INTEGER NOT NULL,          -- per interval
  interval     TEXT NOT NULL DEFAULT 'month',
  max_comps    INTEGER NOT NULL,          -- comps a user may commission
  max_players  INTEGER NOT NULL,          -- roster cap per comp
  features_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id            TEXT NOT NULL REFERENCES plans(id),
  status             TEXT NOT NULL DEFAULT 'active', -- active|canceled|past_due
  current_period_end TEXT,
  provider           TEXT DEFAULT 'mock',            -- 'stripe' later
  provider_ref       TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,                 -- season|event|window
  cadence        TEXT,
  blurb          TEXT,
  color          TEXT DEFAULT '#7C6BE0',
  invite_code    TEXT UNIQUE NOT NULL,
  commissioner_id INTEGER NOT NULL REFERENCES users(id),
  -- Reward plumbing (works both ways) --
  reward_mode    TEXT NOT NULL DEFAULT 'none',  -- 'none' | 'cash'
  buy_in_cents   INTEGER NOT NULL DEFAULT 0,
  rake_pct       REAL NOT NULL DEFAULT 0,        -- platform/host cut, 0..1
  payout_split   TEXT NOT NULL DEFAULT '{"1":1}',-- position -> share of pot
  currency       TEXT NOT NULL DEFAULT 'AUD',
  settled        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memberships (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id   INTEGER NOT NULL REFERENCES comps(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'player',       -- 'commissioner' | 'player'
  entry_paid INTEGER NOT NULL DEFAULT 0,          -- has the buy-in cleared
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(comp_id, user_id)
);

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id      INTEGER NOT NULL REFERENCES comps(id) ON DELETE CASCADE,
  category     TEXT NOT NULL,
  title        TEXT NOT NULL,
  lock_date    TEXT NOT NULL,
  resolve_date TEXT NOT NULL,
  feed_tier    TEXT NOT NULL DEFAULT 'manual',    -- auto|assisted|manual
  provider     TEXT,
  feed_why     TEXT,
  points       INTEGER NOT NULL DEFAULT 10
);

CREATE TABLE IF NOT EXISTS options (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label    TEXT NOT NULL,
  ord      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tips (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id  INTEGER NOT NULL REFERENCES options(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, user_id)
);

-- Feed proposal awaiting a commissioner decision (the "assisted" tier).
CREATE TABLE IF NOT EXISTS proposals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  provider    TEXT,
  outcome_json TEXT NOT NULL,        -- array of option ids
  confidence  TEXT NOT NULL DEFAULT 'review',
  conflict    INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Committed result. One row per resolved event; winners in result_outcomes
-- so dead heats are first-class.
CREATE TABLE IF NOT EXISTS results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  method      TEXT NOT NULL,          -- confirmed|overridden|manual
  source      TEXT,
  seq         INTEGER NOT NULL,       -- resolution order, for ladder movement
  resolved_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS result_outcomes (
  result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES options(id)
);

-- Payouts written at settle time (cash comps only).
CREATE TABLE IF NOT EXISTS payouts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id     INTEGER NOT NULL REFERENCES comps(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  position    INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending|paid|failed
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_comp   ON events(comp_id);
CREATE INDEX IF NOT EXISTS idx_options_event ON options(event_id);
CREATE INDEX IF NOT EXISTS idx_tips_event    ON tips(event_id);
CREATE INDEX IF NOT EXISTS idx_members_comp  ON memberships(comp_id);
