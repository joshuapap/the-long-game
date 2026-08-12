'use strict';
// Licensed sports-data adapter (the 'auto' tier). This is the integration
// seam for Sportradar / API-Football / Champion Data etc. Each real provider
// gets a small module that returns a normalised { winnerText, confidence }.
//
// Kept as an interface with a keyed stub: with no API key configured it
// returns null (→ the event drops to the manual queue rather than guessing).
// Wire a real endpoint per provider by filling in `fetchByProvider`.

const KEYS = {
  'API-Football': process.env.APIFOOTBALL_KEY,
  'Sportradar':   process.env.SPORTRADAR_KEY,
  'SportsDataIO': process.env.SPORTSDATAIO_KEY,
  'Champion Data':process.env.CHAMPIONDATA_KEY,
};

function hasKey(provider) {
  return Object.entries(KEYS).some(([name, key]) => provider.includes(name) && key);
}

/**
 * @returns {Promise<null | {winnerText:string, confidence:'high'|'review', source:string}>}
 */
async function fetchResult(event) {
  if (!hasKey(event.provider || '')) return null;   // no credentials → no auto result
  // Real call would go here, e.g.:
  //   const r = await fetch(`https://v3.football.api-sports.io/fixtures?...`,
  //                         { headers: { 'x-apisports-key': KEYS['API-Football'] } });
  //   return normalise(await r.json());
  return null;
}

module.exports = { fetchResult, hasKey };
