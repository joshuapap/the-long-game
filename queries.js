'use strict';
// Shapes DB rows into the plain structures the scoring/pot engines expect.
const { db } = require('../db');

const rosterOf = (compId) => db.prepare(`
  SELECT u.id, u.display_name AS name, u.avatar_color AS color, m.role, m.entry_paid
  FROM memberships m JOIN users u ON u.id = m.user_id
  WHERE m.comp_id = ? ORDER BY u.display_name`).all(compId);

const eventsOf = (compId) =>
  db.prepare('SELECT * FROM events WHERE comp_id = ? ORDER BY resolve_date, id').all(compId);

// tips: { [eventId]: { [userId]: optionId } }
function tipsOf(compId) {
  const rows = db.prepare(`
    SELECT t.event_id, t.user_id, t.option_id FROM tips t
    JOIN events e ON e.id = t.event_id WHERE e.comp_id = ?`).all(compId);
  const map = {};
  for (const r of rows) (map[r.event_id] ||= {})[r.user_id] = r.option_id;
  return map;
}

// results: { [eventId]: { winners:[optionId], seq, method, source } }
function resultsOf(compId) {
  const rows = db.prepare(`
    SELECT r.event_id, r.seq, r.method, r.source, ro.option_id FROM results r
    JOIN events e ON e.id = r.event_id
    LEFT JOIN result_outcomes ro ON ro.result_id = r.id
    WHERE e.comp_id = ?`).all(compId);
  const map = {};
  for (const r of rows) {
    const m = (map[r.event_id] ||= { winners: [], seq: r.seq, method: r.method, source: r.source });
    if (r.option_id != null) m.winners.push(r.option_id);
  }
  return map;
}

const paidCount = (compId) =>
  db.prepare('SELECT COUNT(*) n FROM memberships WHERE comp_id = ? AND entry_paid = 1').get(compId).n;

const compState = (comp, asOf) => {
  const evs = eventsOf(comp.id);
  if (!evs.length) return 'upcoming';
  if (evs.every(e => e.resolve_date <= asOf)) return 'finished';
  if (evs.every(e => e.lock_date > asOf)) return 'upcoming';
  return 'live';
};

module.exports = { rosterOf, eventsOf, tipsOf, resultsOf, paidCount, compState };
