'use strict';
// Email + password auth with opaque DB-backed session tokens in an httpOnly
// cookie. Real accounts, hashed passwords — the money/KYC layer bolts on later.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { db } = require('../db');

const COOKIE = 'lg_session';
const DAY = 86400000;
const AVATAR_COLORS = ['#7C6BE0', '#4FCE8F', '#F2686B', '#E8B45C', '#47C8C1', '#F782B4', '#A07DD5', '#5B9BE8'];

function createUser(email, password, displayName) {
  const hash = bcrypt.hashSync(password, 10);
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const info = db.prepare(
    'INSERT INTO users (email, password_hash, display_name, avatar_color) VALUES (?,?,?,?)'
  ).run(email.toLowerCase().trim(), hash, displayName.trim(), color);
  // Everyone starts on the free plan.
  db.prepare('INSERT INTO subscriptions (user_id, plan_id, status) VALUES (?, ?, ?)')
    .run(info.lastInsertRowid, 'free', 'active');
  return info.lastInsertRowid;
}

function startSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 30 * DAY).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, userId, expires);
  return token;
}

function userFromToken(token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s || new Date(s.expires_at) < new Date()) return null;
  return db.prepare('SELECT id, email, display_name, avatar_color FROM users WHERE id = ?').get(s.user_id);
}

// Populates req.user (or null) from the cookie.
function attachUser(req, _res, next) {
  const token = parseCookie(req.headers.cookie)[COOKIE];
  req.user = userFromToken(token);
  next();
}
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'not_authenticated' });
  next();
}

// In production (behind the host's HTTPS) add Secure so the cookie is only sent
// over https. Detected via RENDER (set by Render) or LG_ENV=production.
const SECURE = !!(process.env.RENDER || process.env.LG_ENV === 'production');
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}${SECURE ? '; Secure' : ''}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE ? '; Secure' : ''}`);
}
function parseCookie(str = '') {
  return Object.fromEntries(str.split(';').map(p => p.trim().split('=').map(decodeURIComponent))
    .filter(kv => kv[0]));
}

module.exports = {
  createUser, startSession, userFromToken, attachUser, requireAuth,
  setSessionCookie, clearSessionCookie, verify: (pw, hash) => bcrypt.compareSync(pw, hash), COOKIE,
};
