'use strict';
// Pure scoring engine — no DB, no I/O. Ported from the prototype so it can be
// unit-tested in isolation and reused by the API and any batch settler.
//
// Rule: each resolved event is worth `points` (default 10), split equally
// between everyone who tipped a winning outcome. Dead heats resolve to
// multiple winning options; a tip on any of them counts.

/**
 * @param {Array} roster   [{id}]
 * @param {Array} events    [{id, points}]
 * @param {Object} tips      { [eventId]: { [userId]: optionId } }
 * @param {Object} results   { [eventId]: { winners:[optionId], seq } }  // resolved only
 * @param {number} [maxSeq]  cap resolutions at this seq (for prior-ladder / movement)
 * @returns {{ totals:Object, hits:Object }}
 */
function computeTotals(roster, events, tips, results, maxSeq = Infinity) {
  const totals = {}, hits = {};
  for (const p of roster) { totals[p.id] = 0; hits[p.id] = 0; }
  for (const ev of events) {
    const r = results[ev.id];
    if (!r || !r.winners || !r.winners.length || r.seq > maxSeq) continue;
    const evTips = tips[ev.id] || {};
    const winners = roster.filter(p => r.winners.includes(evTips[p.id]));
    if (!winners.length) continue;               // nobody right → points carry nowhere
    const share = (ev.points ?? 10) / winners.length;
    for (const p of winners) { totals[p.id] += share; hits[p.id] += 1; }
  }
  return { totals, hits };
}

function rankOrder(roster, totals) {
  return roster.slice().sort((a, b) =>
    (totals[b.id] - totals[a.id]) || String(a.name).localeCompare(String(b.name)));
}

/**
 * Full ladder with round-over-round movement.
 * @returns {Array} [{ user, pos, move, pts, hits }]
 */
function ladder(roster, events, tips, results) {
  const { totals, hits } = computeTotals(roster, events, tips, results);
  const cur = rankOrder(roster, totals);
  const seqs = Object.values(results).map(r => r.seq).filter(Number.isFinite);
  const maxSeq = seqs.length ? Math.max(...seqs) : 0;
  const prevTotals = computeTotals(roster, events, tips, results, Math.max(0, maxSeq - 1)).totals;
  const prev = rankOrder(roster, prevTotals);
  const prevPos = {};
  prev.forEach((p, i) => { prevPos[p.id] = i + 1; });
  return cur.map((p, i) => ({
    user: p, pos: i + 1, move: prevPos[p.id] - (i + 1),
    pts: totals[p.id], hits: hits[p.id],
  }));
}

/** Points a tipper would earn if `optionId` wins, given current backers. */
function payoffFor(event, optionId, tips, roster, meId) {
  const evTips = tips[event.id] || {};
  const backers = roster.filter(p => evTips[p.id] === optionId).length;
  const n = evTips[meId] === optionId ? backers : backers + 1;
  return (event.points ?? 10) / Math.max(1, n);
}

module.exports = { computeTotals, rankOrder, ladder, payoffFor };
