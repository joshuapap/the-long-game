'use strict';
// The scraper's job is to map messy editorial result text onto our fixed option
// set. That mapping is what we test, against an inline BBC-Sport-shaped fixture —
// no live network, so the test is deterministic.
const { test } = require('node:test');
const assert = require('node:assert');
const scraper = require('../src/services/results/providers/scrapeProvider');

const BBC_FIXTURE = `<!doctype html><html><head><title>Melbourne Cup - BBC Sport</title>
<script>window.__data={ignore:true}</script></head><body>
<header>BBC Sport</header>
<main><h1>Melbourne Cup result</h1>
<div class="report"><p>Roughie A stormed home to win the Melbourne Cup by a length,
with the Favourite back in third.</p></div></main></body></html>`;

test('extractText strips scripts and collapses whitespace', () => {
  const t = scraper.extractText(BBC_FIXTURE);
  assert.ok(t.includes('Roughie A stormed home'));
  assert.ok(!t.includes('window.__data'));
});

test('matchWinner picks the option named as the winner', () => {
  const m = scraper.matchWinner(['Favourite', 'Roughie A', 'Roughie B', 'Other'], scraper.extractText(BBC_FIXTURE));
  assert.strictEqual(m.label, 'Roughie A');
});

test('matchWinner never infers Other/None/Draw', () => {
  assert.strictEqual(scraper.matchWinner(['Other', 'None'], 'nothing relevant here about other none'), null);
});

test('matchWinner returns null when no option appears', () => {
  assert.strictEqual(scraper.matchWinner(['Alpha', 'Bravo'], 'a report mentioning neither team'), null);
});

test('fetchResult proposes from an injected page (no network) and flags review', async () => {
  const r = await scraper.fetchResult(
    { provider: 'BBC Sport', title: 'Melbourne Cup winner' },
    ['Favourite', 'Roughie A', 'Roughie B', 'Other'],
    { htmlOverride: BBC_FIXTURE });
  assert.strictEqual(r.winnerLabel, 'Roughie A');
  assert.strictEqual(r.confidence, 'review');   // scraped results are always human-confirmed
  assert.strictEqual(r.source, 'BBC Sport');
});

test('fetchResult returns null on fetch failure (→ manual queue)', async () => {
  const r = await scraper.fetchResult({ provider: 'BBC Sport', title: 'x' }, ['A', 'B'],
    { fetchImpl: async () => { throw new Error('network down'); } });
  assert.strictEqual(r, null);
});
