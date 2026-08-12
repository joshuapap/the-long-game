'use strict';
// High-trust scraper (the 'assisted' tier). We only scrape reputable editorial
// sources — BBC Sport by default — and we NEVER auto-commit what we scrape:
// the parser proposes a winner, a commissioner confirms it. That keeps a human
// between a fragile scrape and anyone's points (or money).
//
// The parsing core is pure and unit-tested against a saved fixture, so it does
// not depend on live network. `fetchResult` wires it to a real fetch.

const cheerio = require('cheerio');

const SOURCES = {
  'BBC Sport': {
    // A results/scores landing page per sport. Real routing would pick the
    // sport + date; this is the seam.
    base: 'https://www.bbc.com/sport',
    label: 'BBC Sport',
  },
};

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Pull human-readable text out of a page (scripts/styles removed). */
function extractText(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $('body').text().replace(/\s+/g, ' ').trim() || $.root().text().replace(/\s+/g, ' ').trim();
}

// Words that mark the winner. Deliberately winner-positive (not 'beat'/'defeat',
// which are directionally ambiguous — "X was beaten" points the wrong way).
const WIN_CUES = ['winner', 'wins', 'won', 'win', 'champion', 'victory', 'crowned', 'triumph', 'title', 'claims'];
const CUE_WINDOW = 60;   // a winning option should sit near a winning cue

/**
 * Map free result text onto our fixed option set. An option only wins if it's
 * both present AND closer to a winning cue than any rival — so "X won, with Y
 * back in third" resolves to X, not Y. Ambiguous or cue-less → null (drops to
 * the manual queue rather than guessing). This is the part that matters, so
 * it's the part we test.
 * @returns {null | {label:string, score:number}}
 */
function matchWinner(optionLabels, text) {
  const hay = norm(text);
  const cues = [];
  for (const cue of WIN_CUES) { for (let i = hay.indexOf(cue); i >= 0; i = hay.indexOf(cue, i + 1)) cues.push(i); }
  if (!cues.length) return null;

  let best = null, tie = false;
  for (const label of optionLabels) {
    if (/^(other|none|draw)$/i.test(label.trim())) continue;  // never infer these
    const needle = norm(label);
    if (!needle) continue;
    let dist = Infinity;
    for (let p = hay.indexOf(needle); p >= 0; p = hay.indexOf(needle, p + 1))
      for (const c of cues) dist = Math.min(dist, Math.abs(c - p));
    if (dist === Infinity) continue;                           // label not present
    if (!best || dist < best.dist) { best = { label, dist }; tie = false; }
    else if (dist === best.dist) tie = true;
  }
  if (!best || tie || best.dist > CUE_WINDOW) return null;
  return { label: best.label, score: 1 / (1 + best.dist) };
}

/**
 * Fetch a source page and propose a winning option.
 * @param {object} event  { provider, category, title }
 * @param {string[]} optionLabels
 * @param {object} [deps] { fetchImpl, htmlOverride } — injectable for tests
 * @returns {Promise<null | {winnerLabel, confidence, source, note}>}
 */
async function fetchResult(event, optionLabels, deps = {}) {
  const src = SOURCES[event.provider] || SOURCES['BBC Sport'];
  try {
    let html = deps.htmlOverride;
    if (html == null) {
      const doFetch = deps.fetchImpl || globalThis.fetch;
      const url = `${src.base}?q=${encodeURIComponent(event.title)}`;
      const res = await doFetch(url, { headers: { 'user-agent': 'TheLongGame/0.1 (+results-ingest)' } });
      if (!res.ok) return null;
      html = await res.text();
    }
    const match = matchWinner(optionLabels, extractText(html));
    if (!match) return null;
    return {
      winnerLabel: match.label,
      confidence: 'review',            // scraped → always a human-checked proposal
      source: src.label,
      note: `Proposed from ${src.label}; confirm before it scores.`,
    };
  } catch {
    return null;                        // any failure → drop to manual queue
  }
}

module.exports = { fetchResult, matchWinner, extractText, SOURCES };
