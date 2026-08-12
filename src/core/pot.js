'use strict';
// Pot funding and payout distribution — integer cents throughout, no floats
// for money. Same functions serve non-cash comps (they just return a zero pot).

/**
 * Gross pot = paid entries × buy-in. Net pot = gross − host rake.
 * @param {{reward_mode, buy_in_cents, rake_pct}} comp
 * @param {number} paidPlayers  count of members with a cleared entry
 */
function computePot(comp, paidPlayers) {
  if (comp.reward_mode !== 'cash' || !comp.buy_in_cents) {
    return { gross: 0, rake: 0, net: 0, paidPlayers };
  }
  const gross = comp.buy_in_cents * paidPlayers;
  const rake = Math.round(gross * (comp.rake_pct || 0));
  return { gross, rake, net: gross - rake, paidPlayers };
}

/** Normalise a payout split ({"1":0.6,...}) into shares that sum to 1. */
function normaliseSplit(split) {
  const entries = Object.entries(split).map(([k, v]) => [Number(k), Number(v)]);
  const sum = entries.reduce((s, [, v]) => s + v, 0) || 1;
  return entries.map(([pos, v]) => [pos, v / sum]).sort((a, b) => a[0] - b[0]);
}

/**
 * What a given ladder position is playing for right now.
 * @returns {number} cents (0 if position isn't in the money or comp is non-cash)
 */
function prizeForPosition(comp, paidPlayers, position) {
  const { net } = computePot(comp, paidPlayers);
  if (!net) return 0;
  const share = normaliseSplit(JSON.parse(comp.payout_split || '{"1":1}'))
    .find(([pos]) => pos === position);
  return share ? Math.round(net * share[1]) : 0;
}

/**
 * Final distribution at settle. Largest-remainder rounding so the parts
 * always sum exactly to the net pot (no lost/created cents).
 * @param {Array} ladderRows  [{ user, pos }] sorted by position
 * @returns {Array} [{ userId, position, amount_cents }]
 */
function distribute(comp, paidPlayers, ladderRows) {
  const { net } = computePot(comp, paidPlayers);
  const split = normaliseSplit(JSON.parse(comp.payout_split || '{"1":1}'));
  if (!net) return [];

  const raw = split.map(([pos, share]) => {
    const row = ladderRows.find(r => r.pos === pos);
    return row ? { userId: row.user.id, position: pos, exact: net * share } : null;
  }).filter(Boolean);

  const out = raw.map(r => ({ ...r, amount_cents: Math.floor(r.exact) }));
  let remainder = net - out.reduce((s, r) => s + r.amount_cents, 0);
  out.sort((a, b) => (b.exact - b.amount_cents) - (a.exact - a.amount_cents));
  for (let i = 0; i < out.length && remainder > 0; i++, remainder--) out[i].amount_cents += 1;
  return out.map(({ userId, position, amount_cents }) => ({ userId, position, amount_cents }))
            .sort((a, b) => a.position - b.position);
}

const fmtMoney = (cents, currency = 'AUD') =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format((cents || 0) / 100);

module.exports = { computePot, normaliseSplit, prizeForPosition, distribute, fmtMoney };
