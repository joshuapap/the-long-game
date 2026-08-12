'use strict';
// Single SQLite connection, migrated from schema.sql on first open.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DB_PATH = process.env.LG_DB || path.join(__dirname, '..', '..', 'data', 'long-game.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
// WAL is preferred but unsupported on some network/overlay filesystems; fall
// back quietly to the default rollback journal there.
try { db.exec('PRAGMA journal_mode = WAL;'); } catch { /* keep default journal */ }
db.exec('PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// A brand-new (production) database has no plans, and registration needs them,
// so make sure the three plans always exist. Idempotent — safe on every boot.
function ensurePlans() {
  const PLANS = [
    ['free',   'Free',   0,    1,  8,   ['1 competition', 'Up to 8 players', 'Manual + assisted results']],
    ['club',   'Club',   900,  5,  30,  ['5 competitions', 'Up to 30 players', 'Auto result feeds', 'Cash pots']],
    ['league', 'League', 2900, 25, 200, ['25 competitions', 'Up to 200 players', 'Priority feeds', 'Cash pots', 'Branding']],
  ];
  const up = db.prepare(`INSERT OR REPLACE INTO plans
    (id,name,price_cents,interval,max_comps,max_players,features_json) VALUES (?,?,?,?,?,?,?)`);
  for (const [id, name, price, maxC, maxP, feat] of PLANS)
    up.run(id, name, price, 'month', maxC, maxP, JSON.stringify(feat));
}
ensurePlans();

module.exports = { db, DB_PATH };
