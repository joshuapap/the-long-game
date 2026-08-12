'use strict';
// Resolution orchestrator. For each event that has happened but isn't resolved,
// try to produce a proposal the commissioner can confirm:
//   auto      → licensed API adapter
//   assisted  → high-trust scraper (proposal only)
//   manual    → nothing; sits in the manual queue for adjudication
// Nothing here ever writes a committed result — that's a commissioner action.

const { db } = require('../../db');
const api = require('./providers/apiProvider');
const scraper = require('./providers/scrapeProvider');

const optionsFor = (eventId) =>
  db.prepare('SELECT id, label FROM options WHERE event_id = ? ORDER BY ord').all(eventId);

/**
 * @param {number} compId
 * @param {string} asOf  ISO date; events with resolve_date <= asOf are "in"
 * @returns {Promise<{proposed:number, manual:number}>}
 */
async function syncFeeds(compId, asOf) {
  const events = db.prepare(`
    SELECT e.* FROM events e
    LEFT JOIN results r ON r.event_id = e.id
    WHERE e.comp_id = ? AND r.id IS NULL AND e.resolve_date <= ?
  `).all(compId, asOf);

  let proposed = 0, manual = 0;
  for (const ev of events) {
    if (db.prepare('SELECT 1 FROM proposals WHERE event_id = ?').get(ev.id)) continue;
    const opts = optionsFor(ev.id);
    const labels = opts.map(o => o.label);
    let outcome = null, provider = ev.provider, confidence = 'review', note = null;

    if (ev.feed_tier === 'auto') {
      const r = await api.fetchResult(ev);
      if (r) { outcome = labels.filter(l => r.winnerText && norm(l) === norm(r.winnerText));
               confidence = r.confidence; provider = r.source; }
    } else if (ev.feed_tier === 'assisted') {
      const r = await scraper.fetchResult(ev, labels);
      if (r) { outcome = [r.winnerLabel]; confidence = r.confidence; provider = r.source; note = r.note; }
    }

    if (outcome && outcome.length) {
      const ids = outcome.map(l => opts.find(o => o.label === l).id);
      db.prepare(`INSERT INTO proposals (event_id, provider, outcome_json, confidence, conflict, note)
                  VALUES (?,?,?,?,?,?)`)
        .run(ev.id, provider, JSON.stringify(ids), confidence, 0, note);
      proposed++;
    } else {
      manual++;   // no source could decide it → manual queue
    }
  }
  return { proposed, manual };
}

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

module.exports = { syncFeeds };
