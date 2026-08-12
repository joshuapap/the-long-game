'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const scoring = require('../src/core/scoring');
const pot = require('../src/core/pot');

const roster = [{ id: 1, name: 'You' }, { id: 2, name: 'Sam' }, { id: 3, name: 'Priya' }];
const events = [{ id: 10, points: 10 }, { id: 11, points: 10 }, { id: 12, points: 10 }];

test('points split equally among winning tippers', () => {
  const tips = { 10: { 1: 100, 2: 100, 3: 200 } };          // You+Sam on 100
  const results = { 10: { winners: [100], seq: 1 } };
  const { totals } = scoring.computeTotals(roster, events, tips, results);
  assert.strictEqual(totals[1], 5); assert.strictEqual(totals[2], 5); assert.strictEqual(totals[3], 0);
});

test('sole correct tipper takes the full ten', () => {
  const tips = { 10: { 1: 100, 2: 200, 3: 300 } };
  const results = { 10: { winners: [100], seq: 1 } };
  assert.strictEqual(scoring.computeTotals(roster, events, tips, results).totals[1], 10);
});

test('dead heat: a tip on either winning option counts', () => {
  const tips = { 10: { 1: 100, 2: 101, 3: 200 } };
  const results = { 10: { winners: [100, 101], seq: 1 } };  // two winning options
  const { totals } = scoring.computeTotals(roster, events, tips, results);
  assert.strictEqual(totals[1], 5); assert.strictEqual(totals[2], 5); assert.strictEqual(totals[3], 0);
});

test('nobody right → no points awarded', () => {
  const tips = { 10: { 1: 200, 2: 200, 3: 200 } };
  const results = { 10: { winners: [100], seq: 1 } };
  const { totals } = scoring.computeTotals(roster, events, tips, results);
  assert.deepStrictEqual(Object.values(totals), [0, 0, 0]);
});

test('ladder computes movement vs the prior result', () => {
  const tips = { 10: { 2: 100 }, 11: { 1: 100 } };
  const results = { 10: { winners: [100], seq: 1 }, 11: { winners: [100], seq: 2 } };
  const L = scoring.ladder(roster, events, tips, results);
  assert.strictEqual(L[0].pos, 1);
  assert.ok(L.every(r => typeof r.move === 'number'));
});

test('pot = paid entries × buy-in, minus rake', () => {
  const comp = { reward_mode: 'cash', buy_in_cents: 2500, rake_pct: 0.10 };
  const p = pot.computePot(comp, 6);
  assert.strictEqual(p.gross, 15000);
  assert.strictEqual(p.rake, 1500);
  assert.strictEqual(p.net, 13500);
});

test('non-cash comp has a zero pot', () => {
  assert.strictEqual(pot.computePot({ reward_mode: 'none', buy_in_cents: 0 }, 8).net, 0);
});

test('payout distribution sums exactly to the net pot', () => {
  const comp = { reward_mode: 'cash', buy_in_cents: 2500, rake_pct: 0.10, payout_split: '{"1":0.6,"2":0.3,"3":0.1}' };
  const rows = [1, 2, 3, 4].map(pos => ({ pos, user: { id: pos } }));
  const dist = pot.distribute(comp, 6, rows);   // net 13500
  assert.strictEqual(dist.reduce((s, d) => s + d.amount_cents, 0), 13500);
  assert.strictEqual(dist[0].amount_cents, 8100);   // 60%
});

test('odd split still reconciles to the cent (largest remainder)', () => {
  const comp = { reward_mode: 'cash', buy_in_cents: 3333, rake_pct: 0, payout_split: '{"1":0.5,"2":0.3,"3":0.2}' };
  const rows = [1, 2, 3].map(pos => ({ pos, user: { id: pos } }));
  const dist = pot.distribute(comp, 7, rows);       // net 23331
  assert.strictEqual(dist.reduce((s, d) => s + d.amount_cents, 0), 23331);
});
