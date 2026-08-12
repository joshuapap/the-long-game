'use strict';
const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const { db } = require('../db');
const auth = require('./auth');
const Q = require('./queries');
const scoring = require('../core/scoring');
const pot = require('../core/pot');
const results = require('../services/results');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind the host's HTTPS proxy (Render), for real client IPs + Secure cookies
app.use(express.json({ limit: '64kb' }));
app.use(auth.attachUser);

// Simple in-memory rate limiter — enough to blunt credential-stuffing on a
// single node. Swap for a shared store (Redis) when you run more than one.
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'x') + ':' + req.path;
    const now = Date.now();
    const rec = hits.get(key) || { count: 0, reset: now + windowMs };
    if (now > rec.reset) { rec.count = 0; rec.reset = now + windowMs; }
    rec.count++; hits.set(key, rec);
    if (rec.count > max) return res.status(429).json({ error: 'too_many_requests',
      message: 'Too many attempts. Try again shortly.' });
    next();
  };
}
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

// Demo "clock" so the seeded season can be advanced without waiting a year.
// Real deployments just use the wall clock.
const today = () => (process.env.LG_NOW || new Date().toISOString().slice(0, 10));

const publicUser = (u) => u && { id: u.id, name: u.display_name, color: u.avatar_color };
const money = pot.fmtMoney;

/* ----------------------------- auth ----------------------------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
app.post('/api/auth/register', authLimiter, (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (!email || !password || !displayName) return res.status(400).json({ error: 'missing_fields' });
  if (!EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'bad_email' });
  if (String(displayName).length > 40) return res.status(400).json({ error: 'name_too_long' });
  if (String(password).length < 6) return res.status(400).json({ error: 'weak_password' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.toLowerCase().trim()))
    return res.status(409).json({ error: 'email_taken' });
  const id = auth.createUser(email, password, displayName);
  auth.setSessionCookie(res, auth.startSession(id));
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase().trim());
  if (!u || !auth.verify(password || '', u.password_hash)) return res.status(401).json({ error: 'bad_credentials' });
  auth.setSessionCookie(res, auth.startSession(u.id));
  res.json({ user: publicUser(u) });
});

app.post('/api/auth/logout', (req, res) => { auth.clearSessionCookie(res); res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const sub = db.prepare(`SELECT s.*, p.name plan_name, p.max_comps, p.max_players
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.user_id = ? AND s.status = 'active' ORDER BY s.id DESC LIMIT 1`).get(req.user.id);
  res.json({ user: publicUser(req.user), subscription: sub, now: today() });
});

/* ---------------------------- billing --------------------------- */
app.get('/api/plans', (_req, res) =>
  res.json({ plans: db.prepare('SELECT * FROM plans ORDER BY price_cents').all()
    .map(p => ({ ...p, price: money(p.price_cents), features: JSON.parse(p.features_json) })) }));

// Mock subscribe. Swap for Stripe Checkout + webhook; entitlement logic stays.
app.post('/api/subscribe', auth.requireAuth, (req, res) => {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.body?.planId);
  if (!plan) return res.status(404).json({ error: 'no_such_plan' });
  db.prepare("UPDATE subscriptions SET status='canceled' WHERE user_id=? AND status='active'").run(req.user.id);
  db.prepare(`INSERT INTO subscriptions (user_id, plan_id, status, current_period_end, provider)
    VALUES (?,?,?,?,'mock')`).run(req.user.id, plan.id,
      'active', new Date(Date.now() + 30 * 86400000).toISOString());
  res.json({ ok: true, plan: plan.id });
});

/* ----------------------------- comps ---------------------------- */
function compView(comp, userId, asOf) {
  const roster = Q.rosterOf(comp.id);
  const events = Q.eventsOf(comp.id);
  const tips = Q.tipsOf(comp.id);
  const res = Q.resultsOf(comp.id);
  const L = scoring.ladder(roster, events, tips, res);
  const mine = L.find(r => r.user.id === userId) || null;
  const resolved = events.filter(e => res[e.id]).length;
  const potInfo = pot.computePot(comp, Q.paidCount(comp.id));
  const myPrize = mine ? pot.prizeForPosition(comp, potInfo.paidPlayers, mine.pos) : 0;
  return {
    id: comp.id, name: comp.name, type: comp.type, cadence: comp.cadence, color: comp.color,
    invite_code: comp.invite_code, reward_mode: comp.reward_mode, currency: comp.currency,
    is_commissioner: comp.commissioner_id === userId,
    awaiting: comp.commissioner_id === userId
      ? events.filter(e => e.resolve_date <= asOf && !res[e.id]).length : 0,
    buy_in: money(comp.buy_in_cents, comp.currency), settled: !!comp.settled,
    state: Q.compState(comp, asOf), players: roster.length, events: events.length, resolved,
    pot: { ...potInfo, net_display: money(potInfo.net, comp.currency),
           my_prize_cents: myPrize, my_prize: money(myPrize, comp.currency),
           split: JSON.parse(comp.payout_split) },
    me: mine && { pos: mine.pos, move: mine.move, pts: Number(mine.pts.toFixed(1)), hits: mine.hits },
    leader: L[0] && { name: L[0].user.name, pts: Number(L[0].pts.toFixed(1)) },
    second: L[1] && { pts: Number(L[1].pts.toFixed(1)) },
  };
}

app.get('/api/comps', auth.requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT c.* FROM comps c JOIN memberships m ON m.comp_id=c.id
    WHERE m.user_id = ? ORDER BY c.created_at DESC`).all(req.user.id);
  res.json({ comps: rows.map(c => compView(c, req.user.id, today())) });
});

app.post('/api/comps', auth.requireAuth, (req, res) => {
  const sub = db.prepare(`SELECT p.max_comps FROM subscriptions s JOIN plans p ON p.id=s.plan_id
    WHERE s.user_id=? AND s.status='active' ORDER BY s.id DESC LIMIT 1`).get(req.user.id);
  const owned = db.prepare('SELECT COUNT(*) n FROM comps WHERE commissioner_id = ?').get(req.user.id).n;
  if (sub && owned >= sub.max_comps)
    return res.status(402).json({ error: 'plan_limit', message: `Your plan allows ${sub.max_comps} comp(s). Upgrade to run more.` });

  const b = req.body || {};
  const rewardMode = b.reward_mode === 'cash' ? 'cash' : 'none';
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  const info = db.prepare(`INSERT INTO comps
    (name, type, cadence, blurb, color, invite_code, commissioner_id, reward_mode, buy_in_cents, rake_pct, payout_split, currency)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    b.name || 'New Competition', b.type || 'season', b.cadence || '', b.blurb || '',
    b.color || '#7C6BE0', code, req.user.id, rewardMode,
    rewardMode === 'cash' ? Math.round((b.buy_in || 0) * 100) : 0,
    rewardMode === 'cash' ? (b.rake_pct || 0) : 0,
    JSON.stringify(b.payout_split || { 1: 0.6, 2: 0.3, 3: 0.1 }), b.currency || 'AUD');
  db.prepare('INSERT INTO memberships (comp_id, user_id, role, entry_paid) VALUES (?,?,?,1)')
    .run(info.lastInsertRowid, req.user.id, 'commissioner');
  res.json({ comp: compView(db.prepare('SELECT * FROM comps WHERE id=?').get(info.lastInsertRowid), req.user.id, today()) });
});

app.post('/api/comps/join', auth.requireAuth, (req, res) => {
  const comp = db.prepare('SELECT * FROM comps WHERE invite_code = ?').get(String(req.body?.inviteCode || '').toUpperCase().trim());
  if (!comp) return res.status(404).json({ error: 'bad_code' });
  if (db.prepare('SELECT 1 FROM memberships WHERE comp_id=? AND user_id=?').get(comp.id, req.user.id))
    return res.json({ comp: compView(comp, req.user.id, today()), already: true });
  db.prepare('INSERT INTO memberships (comp_id, user_id, role) VALUES (?,?,?)').run(comp.id, req.user.id, 'player');
  res.json({ comp: compView(comp, req.user.id, today()) });
});

// Mark entry paid (mock). Cash comps require a real payment partner here.
app.post('/api/comps/:id/pay', auth.requireAuth, (req, res) => {
  const m = db.prepare('SELECT * FROM memberships WHERE comp_id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!m) return res.status(404).json({ error: 'not_a_member' });
  db.prepare('UPDATE memberships SET entry_paid=1 WHERE id=?').run(m.id);
  res.json({ ok: true });
});

app.get('/api/comps/:id', auth.requireAuth, requireMember, (req, res) =>
  res.json({ comp: compView(req.comp, req.user.id, today()) }));

app.get('/api/comps/:id/ladder', auth.requireAuth, requireMember, (req, res) => {
  const roster = Q.rosterOf(req.comp.id);
  const L = scoring.ladder(roster, Q.eventsOf(req.comp.id), Q.tipsOf(req.comp.id), Q.resultsOf(req.comp.id));
  const potInfo = pot.computePot(req.comp, Q.paidCount(req.comp.id));
  res.json({ ladder: L.map(r => ({
    pos: r.pos, move: r.move, pts: Number(r.pts.toFixed(1)), hits: r.hits,
    user: publicUser({ id: r.user.id, display_name: r.user.name, avatar_color: r.user.color }),
    prize: money(pot.prizeForPosition(req.comp, potInfo.paidPlayers, r.pos), req.comp.currency),
    me: r.user.id === req.user.id,
  })) });
});

app.get('/api/comps/:id/events', auth.requireAuth, requireMember, (req, res) => {
  const asOf = today();
  const tips = Q.tipsOf(req.comp.id), results = Q.resultsOf(req.comp.id);
  const events = Q.eventsOf(req.comp.id).map(e => {
    const opts = db.prepare('SELECT id, label FROM options WHERE event_id=? ORDER BY ord').all(e.id);
    const r = results[e.id];
    return {
      id: e.id, category: e.category, title: e.title, lock_date: e.lock_date, resolve_date: e.resolve_date,
      feed_tier: e.feed_tier, provider: e.provider, locked: e.lock_date <= asOf,
      resolved: !!r, winners: r ? r.winners : [], my_tip: (tips[e.id] || {})[req.user.id] || null,
      options: opts.map(o => ({ id: o.id, label: o.label })),
    };
  });
  res.json({ events });
});

// Pool room: everyone's picks per event (only revealed once an event locks).
app.get('/api/comps/:id/pool', auth.requireAuth, requireMember, (req, res) => {
  const asOf = today();
  const roster = Q.rosterOf(req.comp.id);
  const tips = Q.tipsOf(req.comp.id), results = Q.resultsOf(req.comp.id);
  const events = Q.eventsOf(req.comp.id).map(e => {
    const opts = db.prepare('SELECT id, label FROM options WHERE event_id=? ORDER BY ord').all(e.id);
    const r = results[e.id], locked = e.lock_date <= asOf;
    return {
      id: e.id, title: e.title, category: e.category, locked, resolved: !!r,
      winners: r ? r.winners : [], options: opts,
      // hide who picked what until the event locks, to avoid copycatting
      picks: roster.map(p => ({ user_id: p.id, option_id: locked ? ((tips[e.id] || {})[p.id] || null) : null })),
    };
  });
  res.json({ roster: roster.map(p => publicUser({ id: p.id, display_name: p.name, avatar_color: p.color })), events });
});

// Committed results with provenance (the ledger the Results Desk shows).
app.get('/api/comps/:id/results', auth.requireAuth, requireMember, (req, res) => {
  const rows = db.prepare(`
    SELECT r.event_id, r.method, r.source, r.seq, r.resolved_at, e.title, e.category
    FROM results r JOIN events e ON e.id = r.event_id
    WHERE e.comp_id = ? ORDER BY r.seq DESC`).all(req.comp.id).map(r => ({
      ...r,
      winners: db.prepare(`SELECT o.label FROM result_outcomes ro
        JOIN options o ON o.id = ro.option_id
        JOIN results res ON res.id = ro.result_id
        WHERE res.event_id = ?`).all(r.event_id).map(x => x.label),
    }));
  res.json({ results: rows });
});

// Set up the competition: a commissioner adds the events/questions people tip on.
// User-created events are 'manual' (the commissioner resolves them) since there's
// no feed for an arbitrary question.
app.post('/api/comps/:id/events', auth.requireAuth, requireCommissioner, (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const category = (String(b.category || '').trim()) || 'General';
  const options = Array.isArray(b.options) ? b.options.map(o => String(o || '').trim()).filter(Boolean) : [];
  const lock = String(b.lock_date || '').slice(0, 10);
  const resolve = (String(b.resolve_date || '').slice(0, 10)) || lock;
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (title.length < 3) return res.status(400).json({ error: 'bad_title', message: 'Give the event a title (3+ characters).' });
  if (options.length < 2) return res.status(400).json({ error: 'need_two_options', message: 'Add at least two options to pick between.' });
  if (options.length > 12) return res.status(400).json({ error: 'too_many_options', message: 'Twelve options max.' });
  if (!dateRe.test(lock)) return res.status(400).json({ error: 'bad_lock_date', message: 'Pick a lock date.' });
  if (!dateRe.test(resolve)) return res.status(400).json({ error: 'bad_resolve_date', message: 'Pick a decided-by date.' });
  if (resolve < lock) return res.status(400).json({ error: 'resolve_before_lock', message: 'The decided date can\u2019t be before the lock date.' });
  const info = db.prepare(`INSERT INTO events (comp_id,category,title,lock_date,resolve_date,feed_tier,provider,points)
    VALUES (?,?,?,?,?, 'manual', 'Commissioner', 10)`).run(req.comp.id, category, title, lock, resolve);
  const ins = db.prepare('INSERT INTO options (event_id,label,ord) VALUES (?,?,?)');
  options.forEach((l, i) => ins.run(info.lastInsertRowid, l, i));
  res.json({ ok: true, event_id: info.lastInsertRowid });
});

// Remove an event that hasn't been resolved yet (setup fixups).
app.delete('/api/events/:id', auth.requireAuth, (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'no_event' });
  const comp = db.prepare('SELECT * FROM comps WHERE id=?').get(ev.comp_id);
  const m = db.prepare('SELECT role FROM memberships WHERE comp_id=? AND user_id=?').get(comp.id, req.user.id);
  if (!m || m.role !== 'commissioner') return res.status(403).json({ error: 'not_commissioner' });
  if (db.prepare('SELECT 1 FROM results WHERE event_id=?').get(ev.id)) return res.status(409).json({ error: 'already_resolved', message: 'That event already has a result \u2014 undo it first.' });
  db.prepare('DELETE FROM events WHERE id=?').run(ev.id);   // options/tips/proposals cascade
  res.json({ ok: true });
});

app.post('/api/events/:id/tip', auth.requireAuth, (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'no_event' });
  if (!db.prepare('SELECT 1 FROM memberships WHERE comp_id=? AND user_id=?').get(ev.comp_id, req.user.id))
    return res.status(403).json({ error: 'not_a_member' });
  if (ev.lock_date <= today()) return res.status(409).json({ error: 'locked' });
  const opt = db.prepare('SELECT 1 FROM options WHERE id=? AND event_id=?').get(req.body?.optionId, ev.id);
  if (!opt) return res.status(400).json({ error: 'bad_option' });
  db.prepare(`INSERT INTO tips (event_id, user_id, option_id) VALUES (?,?,?)
    ON CONFLICT(event_id, user_id) DO UPDATE SET option_id=excluded.option_id, created_at=datetime('now')`)
    .run(ev.id, req.user.id, req.body.optionId);
  res.json({ ok: true });
});

/* ------------------------- results desk ------------------------- */
app.post('/api/comps/:id/sync-feeds', auth.requireAuth, requireCommissioner, async (req, res) => {
  const out = await results.syncFeeds(req.comp.id, today());
  res.json(out);
});

app.get('/api/comps/:id/results-queue', auth.requireAuth, requireCommissioner, (req, res) => {
  const asOf = today();
  // options for an event, each with how many tippers backed it
  const optsWithCounts = (eventId) => db.prepare(`
    SELECT o.id, o.label, (SELECT COUNT(*) FROM tips t WHERE t.option_id = o.id) AS picks
    FROM options o WHERE o.event_id = ? ORDER BY o.ord`).all(eventId);
  const proposals = db.prepare(`
    SELECT p.*, e.title, e.category, e.feed_tier, e.provider, e.resolve_date FROM proposals p
    JOIN events e ON e.id = p.event_id WHERE e.comp_id = ?`).all(req.comp.id)
    .map(p => ({ event_id: p.event_id, title: p.title, category: p.category, provider: p.provider,
      confidence: p.confidence, conflict: !!p.conflict, note: p.note,
      outcome: JSON.parse(p.outcome_json),
      outcome_labels: JSON.parse(p.outcome_json).map(id => db.prepare('SELECT label FROM options WHERE id=?').get(id)?.label),
      options: optsWithCounts(p.event_id) }));
  // Anything that has happened, isn't resolved, and has no feed proposal —
  // whatever its tier. That includes 'auto'/'assisted' events a feed couldn't
  // decide (no key, failed scrape), so nothing gets stuck with no way to action it.
  const manual = db.prepare(`
    SELECT e.* FROM events e
    LEFT JOIN results r ON r.event_id=e.id
    LEFT JOIN proposals p ON p.event_id=e.id
    WHERE e.comp_id=? AND r.id IS NULL AND p.id IS NULL AND e.resolve_date<=?
    ORDER BY e.resolve_date`).all(req.comp.id, asOf)
    .map(e => ({ event_id: e.id, title: e.title, category: e.category, provider: e.provider,
      feed_tier: e.feed_tier, resolve_date: e.resolve_date, options: optsWithCounts(e.id) }));
  res.json({ proposals, manual, awaiting: proposals.length + manual.length });
});

// Commit a result. `outcome` = array of option ids (>1 = dead heat).
app.post('/api/events/:id/resolve', auth.requireAuth, (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'no_event' });
  const comp = db.prepare('SELECT * FROM comps WHERE id=?').get(ev.comp_id);
  const mem = db.prepare('SELECT role FROM memberships WHERE comp_id=? AND user_id=?').get(comp.id, req.user.id);
  if (!mem || mem.role !== 'commissioner') return res.status(403).json({ error: 'not_commissioner' });
  const outcome = Array.isArray(req.body?.outcome) ? req.body.outcome : [];
  if (!outcome.length) return res.status(400).json({ error: 'no_outcome' });
  const method = ['confirmed', 'overridden', 'manual'].includes(req.body?.method) ? req.body.method : 'confirmed';

  const seq = (db.prepare('SELECT MAX(seq) m FROM results r JOIN events e ON e.id=r.event_id WHERE e.comp_id=?').get(comp.id).m || 0) + 1;
  const tx = db.prepare('SELECT 1'); // (grouping only)
  db.prepare('DELETE FROM results WHERE event_id=?').run(ev.id);
  const info = db.prepare('INSERT INTO results (event_id, method, source, seq) VALUES (?,?,?,?)')
    .run(ev.id, method, req.body?.source || ev.provider || 'Commissioner', seq);
  const ins = db.prepare('INSERT INTO result_outcomes (result_id, option_id) VALUES (?,?)');
  for (const oid of outcome) ins.run(info.lastInsertRowid, oid);
  db.prepare('DELETE FROM proposals WHERE event_id=?').run(ev.id);
  res.json({ ok: true, seq });
});

// Settle a cash comp: freeze the ladder → payout rows.
app.post('/api/comps/:id/settle', auth.requireAuth, requireCommissioner, (req, res) => {
  const comp = req.comp;
  if (comp.reward_mode !== 'cash') return res.status(400).json({ error: 'not_cash_comp' });
  const roster = Q.rosterOf(comp.id);
  const L = scoring.ladder(roster, Q.eventsOf(comp.id), Q.tipsOf(comp.id), Q.resultsOf(comp.id));
  const dist = pot.distribute(comp, Q.paidCount(comp.id), L);
  db.prepare('DELETE FROM payouts WHERE comp_id=?').run(comp.id);
  const ins = db.prepare('INSERT INTO payouts (comp_id, user_id, position, amount_cents) VALUES (?,?,?,?)');
  for (const d of dist) ins.run(comp.id, d.userId, d.position, d.amount_cents);
  db.prepare('UPDATE comps SET settled=1 WHERE id=?').run(comp.id);
  res.json({ payouts: dist.map(d => ({ ...d, amount: money(d.amount_cents, comp.currency) })) });
});

/* --------------------------- middleware ------------------------- */
function requireMember(req, res, next) {
  const comp = db.prepare('SELECT * FROM comps WHERE id = ?').get(req.params.id);
  if (!comp) return res.status(404).json({ error: 'no_comp' });
  if (!db.prepare('SELECT 1 FROM memberships WHERE comp_id=? AND user_id=?').get(comp.id, req.user.id))
    return res.status(403).json({ error: 'not_a_member' });
  req.comp = comp; next();
}
function requireCommissioner(req, res, next) {
  const comp = db.prepare('SELECT * FROM comps WHERE id = ?').get(req.params.id);
  if (!comp) return res.status(404).json({ error: 'no_comp' });
  const m = db.prepare('SELECT role FROM memberships WHERE comp_id=? AND user_id=?').get(comp.id, req.user.id);
  if (!m || m.role !== 'commissioner') return res.status(403).json({ error: 'not_commissioner' });
  req.comp = comp; next();
}

app.use(express.static(path.join(__dirname, '..', '..', 'public')));
module.exports = app;
