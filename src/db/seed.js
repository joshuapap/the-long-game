'use strict';
// Seeds plans + a demo world ported from the prototype: ten people, four comps
// of different shapes, their events/options, everyone's tips, and results for
// anything decided before the demo clock. One comp (Thursday Night Club) runs
// in CASH mode so the pot/payout plumbing is exercised end to end.
//
//   npm run seed          (create if empty)
//   npm run reset         (wipe + reseed)

const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { db } = require('./index');

const FRESH = process.argv.includes('--fresh');
const NOW = process.env.LG_NOW || '2026-08-12';

if (FRESH) {
  for (const t of ['result_outcomes','results','proposals','tips','options','events',
                   'memberships','payouts','comps','subscriptions','sessions','users','plans'])
    db.exec(`DELETE FROM ${t};`);
}

/* ----------------------------- plans ----------------------------- */
const PLANS = [
  ['free',   'Free',        0,     1,  8,  ['1 competition','Up to 8 players','Manual + assisted results']],
  ['club',   'Club',        900,   5,  30, ['5 competitions','Up to 30 players','Auto result feeds','Cash pots']],
  ['league', 'League',      2900,  25, 200,['25 competitions','Up to 200 players','Priority feeds','Cash pots','Branding']],
];
const upPlan = db.prepare(`INSERT OR REPLACE INTO plans (id,name,price_cents,interval,max_comps,max_players,features_json)
  VALUES (?,?,?,?,?,?,?)`);
for (const [id,name,price,maxC,maxP,feat] of PLANS) upPlan.run(id,name,price,'month',maxC,maxP,JSON.stringify(feat));

if (!FRESH && db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) {
  console.log('Already seeded (use `npm run reset` to wipe). Plans refreshed.');
  process.exit(0);
}

/* ----------------------------- people ---------------------------- */
const COLORS = { you:'#7C6BE0', sam:'#47C8C1', priya:'#F782B4', jordan:'#E8B45C', ellie:'#A07DD5',
  marcus:'#F2686B', tara:'#5B9BE8', noah:'#4FCE8F', dev:'#F0857F', kat:'#8E6FD6' };
const NAMES = { you:'You', sam:'Sam', priya:'Priya', jordan:'Jordan', ellie:'Ellie',
  marcus:'Marcus', tara:'Tara', noah:'Noah', dev:'Dev', kat:'Kat' };
const hash = bcrypt.hashSync('password', 8);   // demo login: <handle>@demo.lg / password
const userId = {};
const insUser = db.prepare('INSERT INTO users (email,password_hash,display_name,avatar_color) VALUES (?,?,?,?)');
const insSub  = db.prepare("INSERT INTO subscriptions (user_id,plan_id,status) VALUES (?,?, 'active')");
for (const h of Object.keys(NAMES)) {
  const id = insUser.run(`${h}@demo.lg`, hash, NAMES[h], COLORS[h]).lastInsertRowid;
  userId[h] = id;
  insSub.run(id, h === 'you' ? 'club' : 'free');   // "you" is on Club so cash comps are allowed
}

/* ---------------------------- comps ------------------------------ */
// [handle key, name, type, cadence, color, roster, reward config]
const W1 = '2026-01-15', W2 = '2026-02-05';
const COMPS = [
  ['tnc', 'Thursday Night Club', 'season', 'One shot per event · two lock waves', '#7C6BE0',
    ['you','sam','priya','jordan','ellie','marcus','tara','noah'],
    { reward_mode:'cash', buy_in_cents:2500, rake_pct:0.10, payout_split:{1:0.6,2:0.3,3:0.1} }],
  ['wc', 'World Cup 2026', 'event', 'Tournament burst · single lock at kickoff', '#F782B4',
    ['you','sam','priya','jordan','ellie','marcus','tara','noah','dev','kat'],
    { reward_mode:'none' }],
  ['aug', 'August Multi-Sport', 'window', 'Rolling month · weekly locks', '#E8B45C',
    ['you','sam','jordan','tara','dev'], { reward_mode:'none' }],
  ['spring', 'Spring Racing Carnival', 'event', 'Carnival · single lock 1 October', '#A07DD5',
    ['you','priya','ellie','marcus','tara','kat'],
    { reward_mode:'cash', buy_in_cents:5000, rake_pct:0.05, payout_split:{1:0.7,2:0.3} }],
];

// Events: [compKey, category, title, [options], lockDate, resolveDate]
const RAW = [
  ['tnc','Tennis','Australian Open — Men\'s singles',['Novak Djokovic','Jannik Sinner','Carlos Alcaraz','Other'],W1,'2026-02-01'],
  ['tnc','NFL','Super Bowl champion',['Kansas City Chiefs','San Francisco 49ers','Buffalo Bills','Other'],W1,'2026-02-08'],
  ['tnc','Cricket','T20 World Cup winner',['India','Australia','England','South Africa','Other'],W1,'2026-03-08'],
  ['tnc','Horse Racing','Golden Slipper winner',['Favourite','Contender A','Contender B','Other'],W1,'2026-03-21'],
  ['tnc','Golf','Masters winner',['Scottie Scheffler','Rory McIlroy','Jon Rahm','Other'],W1,'2026-04-12'],
  ['tnc','Soccer','Premier League winner',['Manchester City','Arsenal','Liverpool','Other'],W1,'2026-05-24'],
  ['tnc','Basketball','NBA Champion',['Boston Celtics','Denver Nuggets','Oklahoma City Thunder','Other'],W2,'2026-06-18'],
  ['tnc','Rugby League','State of Origin series winner',['Queensland','New South Wales'],W1,'2026-07-08'],
  ['tnc','Golf','The Open winner',['Scottie Scheffler','Xander Schauffele','Rory McIlroy','Other'],W2,'2026-07-19'],
  ['tnc','Netball','Super Netball champion',['NSW Swifts','Melbourne Vixens','West Coast Fever','Other'],W2,'2026-08-02'],
  ['tnc','AFL','AFL Wooden Spoon',['West Coast','North Melbourne','Richmond','Other'],W1,'2026-08-23'],
  ['tnc','Novelty','First AFL coach to be sacked',['Coach A','Coach B','Coach C','None'],W1,'2026-06-15'],

  ['wc','Football','First team eliminated',['Team A','Team B','Team C','Other'],'2026-06-11','2026-06-24'],
  ['wc','Football','Group A winner',['Mexico','Poland','Uruguay','Other'],'2026-06-11','2026-06-25'],
  ['wc','Football','Golden Boot — top scorer',['Kylian Mbappé','Erling Haaland','Vinícius Jr','Other'],'2026-06-11','2026-07-19'],
  ['wc','Football','Tournament winner',['Brazil','France','Argentina','England','Spain','Other'],'2026-06-11','2026-07-19'],

  ['aug','NRL','Wk1 · Panthers v Storm winner',['Penrith Panthers','Melbourne Storm','Draw'],'2026-08-01','2026-08-03'],
  ['aug','Soccer','Wk2 · Highest-scoring EPL fixture',['Match A','Match B','Match C','Other'],'2026-08-08','2026-08-10'],
  ['aug','NRL','Wk3 · Highest-scoring NRL team',['Penrith Panthers','Melbourne Storm','Brisbane Broncos','Other'],'2026-08-15','2026-08-17'],
  ['aug','Soccer','Wk4 · Liverpool v Chelsea winner',['Liverpool','Chelsea','Draw'],'2026-08-22','2026-08-24'],
  ['aug','NRL','Wk5 · Minor premiership leader',['Penrith Panthers','Melbourne Storm','Brisbane Broncos','Other'],'2026-08-29','2026-08-31'],

  ['spring','Horse Racing','Caulfield Cup winner',['Favourite','Contender A','Contender B','Other'],'2026-10-01','2026-10-17'],
  ['spring','Horse Racing','Cox Plate winner',['Favourite','Contender A','Contender B','Other'],'2026-10-01','2026-10-24'],
  ['spring','Horse Racing','Melbourne Cup winner',['Favourite','Roughie A','Roughie B','Other'],'2026-10-01','2026-11-03'],
  ['spring','Horse Racing','VRC Oaks winner',['Favourite','Contender A','Contender B','Other'],'2026-10-01','2026-11-05'],
];

const { tierFor } = require('../services/results/providers/registry');
const compId = {};
const insComp = db.prepare(`INSERT INTO comps
  (name,type,cadence,blurb,color,invite_code,commissioner_id,reward_mode,buy_in_cents,rake_pct,payout_split,currency)
  VALUES (?,?,?,?,?,?,?,?,?,?,?, 'AUD')`);
const insMem = db.prepare('INSERT INTO memberships (comp_id,user_id,role,entry_paid) VALUES (?,?,?,?)');
for (const [key,name,type,cadence,color,roster,rw] of COMPS) {
  const code = key.toUpperCase() + '2026';
  const cid = insComp.run(name,type,cadence,'',color,code,userId.you,
    rw.reward_mode || 'none', rw.buy_in_cents || 0, rw.rake_pct || 0,
    JSON.stringify(rw.payout_split || {1:1})).lastInsertRowid;
  compId[key] = cid;
  roster.forEach((h,i) => insMem.run(cid, userId[h], h==='you'?'commissioner':'player',
    (rw.reward_mode==='cash' ? (i % 4 !== 3 ? 1 : 0) : 1)));  // most paid, a couple pending
}

/* -------------------- events, options, tips ---------------------- */
const insEvent = db.prepare(`INSERT INTO events (comp_id,category,title,lock_date,resolve_date,feed_tier,provider,points)
  VALUES (?,?,?,?,?,?,?,10)`);
const insOpt = db.prepare('INSERT INTO options (event_id,label,ord) VALUES (?,?,?)');
const insTip = db.prepare('INSERT OR IGNORE INTO tips (event_id,user_id,option_id) VALUES (?,?,?)');
let seedRng = 20260728;
const rng = () => { seedRng = (seedRng*1103515245 + 12345) & 0x7fffffff; return seedRng / 0x7fffffff; };
const pick = a => a[Math.floor(rng()*a.length)];

const eventsByComp = {};
for (const [key,cat,title,opts,lock,resolve] of RAW) {
  const { tier, provider } = tierFor(cat);
  const eid = insEvent.run(compId[key], cat, title, lock, resolve, tier, provider).lastInsertRowid;
  const optIds = opts.map((label,i) => insOpt.run(eid, label, i).lastInsertRowid);
  (eventsByComp[key] ||= []).push({ eid, optIds, opts, cat, title, resolve });
  // roster tips: everyone tips; "you" leaves a few gaps for outstanding picks
  const roster = COMPS.find(c => c[0]===key)[5];
  for (const h of roster) {
    if (h==='you' && rng() < 0.4) continue;
    insTip.run(eid, userId[h], pick(optIds));
  }
}

/* ---------------- results for anything already decided ----------- */
// Truth = a random option; commit results for events resolved before the clock.
const insResult = db.prepare('INSERT INTO results (event_id,method,source,seq) VALUES (?,?,?,?)');
const insRO = db.prepare('INSERT INTO result_outcomes (result_id,option_id) VALUES (?,?)');
let seq = 0;
for (const key of Object.keys(eventsByComp)) {
  const evs = eventsByComp[key].slice().sort((a,b)=>a.resolve.localeCompare(b.resolve));
  for (const ev of evs) {
    if (ev.resolve > NOW) continue;
    const method = tierFor(ev.cat).tier === 'manual' ? 'manual' : 'confirmed';
    const rid = insResult.run(ev.eid, method, tierFor(ev.cat).provider, ++seq).lastInsertRowid;
    // dead heat on the Golden Slipper, to exercise the split
    const winners = ev.title==='Golden Slipper winner' ? ev.optIds.slice(0,2) : [pick(ev.optIds)];
    for (const oid of winners) insRO.run(rid, oid);
  }
}

const n = t => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
console.log(`Seeded: ${n('users')} users, ${n('comps')} comps, ${n('events')} events, ${n('tips')} tips, ${n('results')} results.`);
console.log('Demo login → you@demo.lg / password   (commissioner of all four comps)');
console.log('Invite codes → TNC2026, WC2026, AUG2026, SPRING2026');
