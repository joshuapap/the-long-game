# The Long Game — v0.1 (working backend + client)

This is the first real, running version — a move from the in-memory HTML prototype
to a persistent client-server app. It builds the plumbing so a competition works
**both ways**: non-cash (bragging rights) or a real cash pot, on the same engine.

Legals are deliberately parked for now — the money features are built but gated
behind a `reward_mode` flag and a mock payment step, so nothing charges a card.

## Run it

Requires **Node 22.5+** (uses the built-in `node:sqlite`, no native build step).

```
cd long-game
npm install
npm run reset      # creates + seeds the demo database (idempotent: wipes first)
npm start          # http://localhost:3000
```

Then open http://localhost:3000 and log in with **you@demo.lg / password**.

The seed sets a demo clock so the season sits mid-flight. To move time, start with:
```
LG_NOW=2026-12-30 npm start      # season fully played out — try Settle
```

Demo logins: `you@demo.lg` (commissioner, on the Club plan) … also `sam@demo.lg`,
`priya@demo.lg`, etc. — all password `password`. Invite codes: `TNC2026`,
`WC2026`, `AUG2026`, `SPRING2026`.

## What works now

- **Accounts & sessions** — register/login, hashed passwords (bcrypt), httpOnly cookie sessions.
- **Subscription plans** — Free / Club / League with real entitlement gating (a free
  user is blocked from a 2nd comp and pushed to upgrade). Billing is mocked at the
  `/api/subscribe` seam — swap in Stripe Checkout + a webhook and the logic stays.
- **Join flow** — create a comp (with plan limits), invite by code, join by code.
- **Tipping & scoring** — pick per event, one shared scoring engine (10 pts/event
  split between correct tippers, dead-heats included), live ladder with movement.
- **Pot & payout plumbing** — a comp can run `reward_mode:'cash'` with a buy-in,
  host rake and a payout split. The dashboard shows the pot and *what you're up for*
  at your current position. `POST /settle` freezes the ladder into payout rows,
  with largest-remainder rounding so the parts sum to the pot to the cent.
- **Results ingestion (3-tier)** — `auto` (licensed API adapter, keyed by env vars),
  `assisted` (high-trust scraper — **BBC Sport** — that *proposes* a winner for a
  human to confirm, never auto-commits), `manual` (commissioner adjudicates).
  Anything a feed can't decide drops to the manual queue rather than guessing.
- **Dark, mobile-first client** — full screens now wired to the API: Dashboard
  (points hero, pot), **Tips** (pick every event by category), **Pool room**
  (everyone's picks, hidden until an event locks, correct picks highlighted),
  **Results Desk** (commissioner-only: sync feeds, confirm/override proposals,
  adjudicate anything a feed couldn't decide, view committed results, settle the
  pot), **create/join** (invite codes; buy-in, rake and payout split for cash comps),
  and Account. Bottom tab bar; the Desk tab appears only on comps you run.
- **Basic hardening** — in-memory rate limiting on auth, email/format validation,
  request-size cap, `x-powered-by` off.

## Layout

```
src/
  db/            schema.sql, connection (node:sqlite), seed.js
  core/          scoring.js (pure), pot.js (pure, integer cents)
  services/results/
                 index.js               resolution orchestrator
                 providers/registry.js  category → tier + provider
                 providers/apiProvider.js   licensed-API seam (Sportradar/API-Football/…)
                 providers/scrapeProvider.js high-trust scraper + tested parser
  api/           app.js (Express routes), auth.js, queries.js
  server.js
public/index.html   client (vanilla JS): dashboard, tips, pool, desk, create/join, account
test/               15 unit tests (scoring, pot, scraper parser)
```

`npm test` → 15/15. The scraper parser is tested against a saved BBC-shaped
fixture, so it's deterministic and needs no live network.

## Honest limitations (next up)

- **Real payments** — `/subscribe` and `/comps/:id/pay` are mocks. Needs Stripe
  (Billing + Connect/escrow for pots) plus KYC before any real money moves.
- **Live feeds** — the API adapters are seams with no keys wired; the BBC scraper
  runs but real pages are JS-heavy, so per-sport routing + parsing needs hardening.
  Both correctly no-op to the manual queue today.
- **Deploy + notifications** — still localhost-only, and there are no push/email
  alerts (lock deadlines, results, "you've been overtaken") yet. Both are first-tier
  items that need a hosting choice / email provider from you.
- **Auth completeness** — email verification and password reset aren't built (need
  an email channel); sessions are DB tokens, fine for now.
- **Real-time, PWA packaging** — not started.
- **Tie handling in payouts** — currently ranks ties by name; a real dead-heat-at-
  the-money policy is a product decision.
```
