'use strict';
// Which tier + provider resolves each category. Mirrors the prototype's
// coverage map. Tiers: 'auto' (licensed API, one-click confirm),
// 'assisted' (fetch a proposal from a high-trust source, human confirms),
// 'manual' (no machine source, commissioner adjudicates).

const CATEGORY = {
  'Soccer':      ['auto', 'API-Football'],
  'Football':    ['auto', 'API-Football'],
  'AFL':         ['auto', 'Champion Data AFL'],
  'NRL':         ['auto', 'Sportradar / NRL'],
  'Rugby League':['auto', 'Sportradar / NRL'],
  'Cricket':     ['auto', 'Sportradar Cricket'],
  'Tennis':      ['auto', 'Sportradar Tennis'],
  'Golf':        ['auto', 'Sportradar Golf'],
  'Basketball':  ['auto', 'SportsDataIO'],
  'Motor Sport': ['auto', 'Sportradar Motorsport'],
  // High-trust editorial results, no clean API → scrape + confirm.
  'Horse Racing':['assisted', 'BBC Sport'],
  'Boxing':      ['assisted', 'BBC Sport'],
  'MMA':         ['assisted', 'BBC Sport'],
  'Surfing':     ['assisted', 'BBC Sport'],
  'Netball':     ['assisted', 'BBC Sport'],
  // Subjective / award / novelty → human only.
  'Novelty':     ['manual', 'Commissioner adjudication'],
  'Awards':      ['manual', 'Commissioner adjudication'],
  'ESPY Awards': ['manual', 'Commissioner adjudication'],
  'Lawn Bowls':  ['manual', 'Commissioner adjudication'],
  'Triathlon':   ['manual', 'Commissioner adjudication'],
};

function tierFor(category) {
  const [tier, provider] = CATEGORY[category] || ['manual', 'Commissioner adjudication'];
  return { tier, provider };
}

module.exports = { tierFor, CATEGORY };
