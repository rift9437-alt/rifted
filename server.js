/**
 * Riftted Realities — Express Server
 * Public site + separate Admin Portal (/admin)
 * Neon PostgreSQL ready · Render-ready
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_COOKIE = 'rr_admin_sid';
const PLAYER_COOKIE = 'rr_player_sid';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const PLAYER_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

const mem = {
  admins: [],
  sessions: new Map(),
  requests: [],
  requestNotes: [],
  games: null,
  activity: [],
  announcements: [],
  players: [],
  users: [],
  playerSessions: new Map(),
  profiles: {},
  settings: {}
};

const SEED_GAMES = [
  { id: 'city-of-crime', title: 'City of Crime', shortDescription: 'Explore a huge connected modern city, drive vehicles and experience open-world crime.', description: 'Explore a huge connected modern city, drive vehicles, explore different environments and experience an open-world crime game.', genre: 'Open-world / Action / 3D', thumbnail: '/games/city-of-crime/thumb.svg', banner: '/games/city-of-crime/banner.svg', gameUrl: '/games/city-of-crime/index.html', status: 'available', version: '0.8.0', featured: true, published: true, sortOrder: 1, releaseDate: '2025-11-01' },
  { id: 'starfall', title: 'Starfall', shortDescription: 'Pilot spacecraft through dangerous space zones, fight and complete missions.', description: 'A space-piloting game with combat, waves and objectives.', genre: 'Space Combat / Simulation', thumbnail: '/games/starfall/thumb.svg', banner: '/games/starfall/banner.svg', gameUrl: '/games/starfall/index.html', status: 'available', version: '0.1.0', featured: true, published: true, sortOrder: 2, releaseDate: '2025-11-08' },
  { id: 'relicbound', title: 'Relicbound', shortDescription: 'Explore dungeons, defeat enemies, collect weapons and discover relics.', description: 'Action dungeon crawler with rooms, combat and relics.', genre: 'Roguelike / Fantasy', thumbnail: '/games/relicbound/thumb.svg', banner: '/games/relicbound/banner.svg', gameUrl: '/games/relicbound/index.html', status: 'available', version: '0.1.0', featured: false, published: true, sortOrder: 3, releaseDate: '2025-11-09' },
  { id: 'overdrive', title: 'Overdrive', shortDescription: 'Race across neon tracks, beat times and unlock futuristic vehicles.', description: 'Futuristic arcade racing with checkpoints and lap times.', genre: 'Racing / Arcade', thumbnail: '/games/overdrive/thumb.svg', banner: '/games/overdrive/banner.svg', gameUrl: '/games/overdrive/index.html', status: 'available', version: '0.1.0', featured: true, published: true, sortOrder: 4, releaseDate: '2025-11-10' }
];
mem.games = SEED_GAMES.map(g => ({ ...g }));

mem.requests = [
  { id: uuidv4(), title: 'Add multiplayer to Starfall', description: 'Would love co-op space combat with friends.', type: 'feature', playerName: 'demo_player', playerId: null, status: 'pending', createdAt: new Date(Date.now() - 86400000 * 2).toISOString(), updatedAt: new Date(Date.now() - 86400000 * 2).toISOString() },
  { id: uuidv4(), title: 'City of Crime FPS drop in industrial', description: 'When many traffic cars spawn near industrial, frame rate dips on mid-range GPU.', type: 'bug', playerName: 'neon_runner', playerId: null, status: 'under_review', createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date(Date.now() - 3600000).toISOString() },
  { id: uuidv4(), title: 'Please add a puzzle game', description: 'Something like a neon sokoban would fit the library.', type: 'game_suggestion', playerName: 'rift_fan', playerId: null, status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
];

let pool = null;
async function initDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('[DB] No DATABASE_URL — in-memory store');
    await ensureDefaultAdmin();
    return;
  }
  try {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: url, ssl: IS_PROD ? { rejectUnauthorized: false } : false });
    await pool.query('SELECT 1');
    await runMigrations();
    await ensureDefaultAdmin();
    console.log('[DB] PostgreSQL connected');
  } catch (err) {
    console.error('[DB] Failed, memory fallback:', err.message);
    pool = null;
    await ensureDefaultAdmin();
  }
}

async function runMigrations() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY, admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS requests (
      id UUID PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, type TEXT NOT NULL,
      player_name TEXT, player_id UUID, status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS request_notes (
      id UUID PRIMARY KEY, request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      admin_id UUID REFERENCES admins(id), body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS admin_activity (
      id UUID PRIMARY KEY, admin_id UUID, action TEXT NOT NULL, meta JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS games_meta (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, short_description TEXT, description TEXT, genre TEXT,
      thumbnail TEXT, banner TEXT, game_url TEXT, status TEXT NOT NULL DEFAULT 'in_development',
      version TEXT, featured BOOLEAN DEFAULT FALSE, published BOOLEAN DEFAULT FALSE,
      sort_order INT DEFAULT 0, release_date TEXT, updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS announcements (
      id UUID PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, published BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'player',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE TABLE IF NOT EXISTS player_sessions (
      id TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT,
      bio TEXT DEFAULT '',
      avatar_id TEXT DEFAULT 'avatar-01',
      accent_color TEXT DEFAULT '#a855f7',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      profile_public BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM games_meta');
  if (rows[0].c === 0) {
    for (const g of SEED_GAMES) {
      await pool.query(
        `INSERT INTO games_meta (id,title,short_description,description,genre,thumbnail,banner,game_url,status,version,featured,published,sort_order,release_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [g.id, g.title, g.shortDescription, g.description, g.genre, g.thumbnail, g.banner, g.gameUrl, g.status, g.version, g.featured, g.published, g.sortOrder, g.releaseDate]
      );
    }
  }
}

async function ensureDefaultAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@riftted.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'ChangeMeNow!123';
  const hash = await bcrypt.hash(password, 12);
  if (pool) {
    const { rows } = await pool.query('SELECT id FROM admins WHERE email=$1', [email]);
    if (!rows.length) {
      await pool.query(
        'INSERT INTO admins (id,email,password_hash,display_name,role) VALUES ($1,$2,$3,$4,$5)',
        [uuidv4(), email, hash, 'Platform Admin', 'admin']
      );
      console.log('[Admin] Created default admin:', email);
    }
  } else if (!mem.admins.find(a => a.email === email)) {
    mem.admins.push({ id: uuidv4(), email, passwordHash: hash, displayName: 'Platform Admin', role: 'admin', createdAt: new Date().toISOString() });
    console.log('[Admin] In-memory admin:', email, '(change ADMIN_PASSWORD in production)');
  }
}

function logActivity(adminId, action, meta = {}) {
  const entry = { id: uuidv4(), adminId, action, meta, createdAt: new Date().toISOString() };
  mem.activity.unshift(entry);
  if (mem.activity.length > 500) mem.activity.length = 500;
  if (pool) pool.query('INSERT INTO admin_activity (id,admin_id,action,meta) VALUES ($1,$2,$3,$4)', [entry.id, adminId, action, meta]).catch(() => {});
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(SESSION_SECRET));
app.use(express.static(path.join(__dirname), { index: false }));
app.use('/games', express.static(path.join(__dirname, 'games')));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many login attempts.' } });

async function getSession(req) {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (!sid) return null;
  if (pool) {
    const { rows } = await pool.query(
      `SELECT s.id, s.csrf_token, s.expires_at, a.id AS admin_id, a.email, a.display_name, a.role
       FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.id=$1`, [sid]);
    if (!rows.length) return null;
    const row = rows[0];
    if (new Date(row.expires_at) < new Date()) { await pool.query('DELETE FROM admin_sessions WHERE id=$1', [sid]); return null; }
    return { sid: row.id, csrf: row.csrf_token, admin: { id: row.admin_id, email: row.email, displayName: row.display_name, role: row.role } };
  }
  const s = mem.sessions.get(sid);
  if (!s || s.expires < Date.now()) { mem.sessions.delete(sid); return null; }
  const admin = mem.admins.find(a => a.id === s.adminId);
  if (!admin) return null;
  return { sid, csrf: s.csrf, admin: { id: admin.id, email: admin.email, displayName: admin.displayName, role: admin.role } };
}

async function requireAdmin(req, res, next) {
  try {
    const session = await getSession(req);
    if (!session || session.admin.role !== 'admin') return res.status(401).json({ success: false, error: 'Unauthorized' });
    req.admin = session.admin; req.adminSession = session; next();
  } catch (e) { res.status(500).json({ success: false, error: 'Session error' }); }
}

function requireCsrf(req, res, next) {
  const token = req.get('x-csrf-token') || req.body?._csrf;
  if (!req.adminSession || !token || token !== req.adminSession.csrf) return res.status(403).json({ success: false, error: 'Invalid CSRF token' });
  next();
}

function setSessionCookie(res, sid) {
  res.cookie(SESSION_COOKIE, sid, { httpOnly: true, secure: IS_PROD, sameSite: 'lax', maxAge: SESSION_TTL_MS, path: '/' });
}
function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: IS_PROD, sameSite: 'lax' });
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Riftted Realities', version: '0.3.0', db: pool ? 'postgres' : 'memory', timestamp: new Date().toISOString() });
});

function publicGamesList() {
  return mem.games.filter(g => g.published).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

app.get('/api/games', (req, res) => {
  const { genre, featured, search, status } = req.query;
  let list = publicGamesList();
  if (genre) list = list.filter(g => g.genre.toLowerCase().includes(String(genre).toLowerCase()));
  if (featured === 'true') list = list.filter(g => g.featured);
  if (status) list = list.filter(g => g.status === status);
  if (search) {
    const q = String(search).toLowerCase();
    list = list.filter(g => g.title.toLowerCase().includes(q) || (g.shortDescription || '').toLowerCase().includes(q) || (g.genre || '').toLowerCase().includes(q));
  }
  res.json({ success: true, count: list.length, data: list });
});

app.get('/api/games/:id', (req, res) => {
  const game = publicGamesList().find(g => g.id === req.params.id);
  if (!game) return res.status(404).json({ success: false, error: 'Game not found' });
  res.json({ success: true, data: game });
});

app.post('/api/requests', rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }), (req, res) => {
  const { title, description, type, playerName } = req.body || {};
  if (!title || !description || !type) return res.status(400).json({ success: false, error: 'title, description and type required' });
  const allowed = ['bug', 'feature', 'game_suggestion', 'game_addition', 'feedback'];
  if (!allowed.includes(type)) return res.status(400).json({ success: false, error: 'Invalid type' });
  const row = { id: uuidv4(), title: String(title).slice(0, 200), description: String(description).slice(0, 5000), type, playerName: String(playerName || 'anonymous').slice(0, 80), playerId: null, status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  mem.requests.unshift(row);
  res.status(201).json({ success: true, data: { id: row.id, status: row.status } });
});


// ─── Player auth helpers ───
function setPlayerCookie(res, sid) {
  res.cookie(PLAYER_COOKIE, sid, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: PLAYER_SESSION_TTL_MS,
    path: '/'
  });
}
function clearPlayerCookie(res) {
  res.clearCookie(PLAYER_COOKIE, { path: '/', httpOnly: true, secure: IS_PROD, sameSite: 'lax' });
}

async function getPlayerSession(req) {
  const sid = req.cookies?.[PLAYER_COOKIE];
  if (!sid) return null;
  if (pool) {
    const { rows } = await pool.query(
      `SELECT s.id, s.csrf_token, s.expires_at, u.id AS user_id, u.username, u.email, u.role
       FROM player_sessions s JOIN users u ON u.id = s.user_id WHERE s.id=$1`,
      [sid]
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (new Date(row.expires_at) < new Date()) {
      await pool.query('DELETE FROM player_sessions WHERE id=$1', [sid]);
      return null;
    }
    return {
      sid: row.id,
      csrf: row.csrf_token,
      user: { id: row.user_id, username: row.username, email: row.email, role: row.role }
    };
  }
  const s = mem.playerSessions.get(sid);
  if (!s || s.expires < Date.now()) {
    mem.playerSessions.delete(sid);
    return null;
  }
  const user = mem.users.find(u => u.id === s.userId);
  if (!user) return null;
  return {
    sid,
    csrf: s.csrf,
    user: { id: user.id, username: user.username, email: user.email, role: user.role }
  };
}

async function requirePlayer(req, res, next) {
  try {
    const session = await getPlayerSession(req);
    if (!session) return res.status(401).json({ success: false, error: 'Unauthorized' });
    req.player = session.user;
    req.playerSession = session;
    next();
  } catch {
    res.status(500).json({ success: false, error: 'Session error' });
  }
}

function requirePlayerCsrf(req, res, next) {
  const token = req.get('x-csrf-token') || req.body?._csrf;
  if (!req.playerSession || !token || token !== req.playerSession.csrf) {
    return res.status(403).json({ success: false, error: 'Invalid CSRF token' });
  }
  next();
}

function validateUsername(u) {
  if (typeof u !== 'string') return 'Username required';
  const t = u.trim();
  if (t.length < 3 || t.length > 24) return 'Username must be 3–24 characters';
  if (!/^[a-zA-Z0-9_]+$/.test(t)) return 'Username may only contain letters, numbers and underscores';
  return null;
}
function validateEmail(e) {
  if (typeof e !== 'string') return 'Email required';
  const t = e.trim().toLowerCase();
  if (t.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return 'Invalid email address';
  return null;
}
function validatePassword(p) {
  if (typeof p !== 'string') return 'Password required';
  if (p.length < 8) return 'Password must be at least 8 characters';
  if (p.length > 128) return 'Password too long';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'Password must include letters and numbers';
  return null;
}

const playerLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Try again later.' }
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many registration attempts. Try again later.' }
});

// ─── Player auth routes ───
app.post('/api/auth/register', registerLimiter, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const confirm = String(req.body?.confirmPassword || req.body?.confirm || '');

    const uErr = validateUsername(username);
    if (uErr) return res.status(400).json({ success: false, error: uErr });
    const eErr = validateEmail(email);
    if (eErr) return res.status(400).json({ success: false, error: eErr });
    const pErr = validatePassword(password);
    if (pErr) return res.status(400).json({ success: false, error: pErr });
    if (password !== confirm) return res.status(400).json({ success: false, error: 'Passwords do not match' });

    const hash = await bcrypt.hash(password, 12);
    const id = uuidv4();

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO users (id, username, email, password_hash, role) VALUES ($1,$2,$3,$4,'player')`,
          [id, username, email, hash]
        );
      } catch (err) {
        if (err.code === '23505') {
          const msg = (err.detail || '').includes('username') ? 'Username already taken' : 'Email already registered';
          return res.status(409).json({ success: false, error: msg });
        }
        throw err;
      }
    } else {
      if (mem.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        return res.status(409).json({ success: false, error: 'Username already taken' });
      }
      if (mem.users.some(u => u.email === email)) {
        return res.status(409).json({ success: false, error: 'Email already registered' });
      }
      mem.users.push({
        id,
        username,
        email,
        passwordHash: hash,
        role: 'player',
        createdAt: new Date().toISOString()
      });
    }

    // Auto-login after register: new session
    const sid = crypto.randomBytes(32).toString('hex');
    const csrf = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + PLAYER_SESSION_TTL_MS);
    if (pool) {
      await pool.query(
        'INSERT INTO player_sessions (id, user_id, csrf_token, expires_at) VALUES ($1,$2,$3,$4)',
        [sid, id, csrf, expires.toISOString()]
      );
    } else {
      mem.playerSessions.set(sid, { userId: id, csrf, expires: expires.getTime() });
    }
    setPlayerCookie(res, sid);
    res.status(201).json({
      success: true,
      data: {
        user: { id, username, email, role: 'player' },
        csrf
      }
    });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

app.post('/api/auth/login', playerLoginLimiter, async (req, res) => {
  try {
    const login = String(req.body?.login || req.body?.email || req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!login || !password) {
      return res.status(400).json({ success: false, error: 'Login and password required' });
    }

    let user = null;
    if (pool) {
      const { rows } = await pool.query(
        `SELECT id, username, email, password_hash, role FROM users
         WHERE lower(username)=lower($1) OR lower(email)=lower($1) LIMIT 1`,
        [login]
      );
      if (rows[0]) {
        user = {
          id: rows[0].id,
          username: rows[0].username,
          email: rows[0].email,
          passwordHash: rows[0].password_hash,
          role: rows[0].role
        };
      }
    } else {
      const q = login.toLowerCase();
      user = mem.users.find(u => u.username.toLowerCase() === q || u.email === q) || null;
    }

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    if (user.role === 'admin') {
      // Players cannot log into the player portal as admin accounts from this endpoint
      // Admin uses /api/admin/login only
    }

    // Session regeneration
    const sid = crypto.randomBytes(32).toString('hex');
    const csrf = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + PLAYER_SESSION_TTL_MS);
    if (pool) {
      await pool.query(
        'INSERT INTO player_sessions (id, user_id, csrf_token, expires_at) VALUES ($1,$2,$3,$4)',
        [sid, user.id, csrf, expires.toISOString()]
      );
    } else {
      mem.playerSessions.set(sid, { userId: user.id, csrf, expires: expires.getTime() });
    }
    setPlayerCookie(res, sid);
    res.json({
      success: true,
      data: {
        user: { id: user.id, username: user.username, email: user.email, role: user.role },
        csrf
      }
    });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const session = await getPlayerSession(req);
    const sid = req.cookies?.[PLAYER_COOKIE];
    if (pool && sid) await pool.query('DELETE FROM player_sessions WHERE id=$1', [sid]);
    else if (sid) mem.playerSessions.delete(sid);
    clearPlayerCookie(res);
    res.json({ success: true });
  } catch {
    clearPlayerCookie(res);
    res.json({ success: true });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const session = await getPlayerSession(req);
    if (!session) return res.status(401).json({ success: false, error: 'Not authenticated' });
    res.json({
      success: true,
      data: {
        user: session.user,
        csrf: session.csrf
      }
    });
  } catch {
    res.status(500).json({ success: false, error: 'Session error' });
  }
});



// ─── Built-in avatars ───
const AVATARS = [
  { id: 'avatar-01', label: 'Neon Pulse', emoji: '🟣' },
  { id: 'avatar-02', label: 'Cyan Core', emoji: '🔵' },
  { id: 'avatar-03', label: 'Crimson', emoji: '🔴' },
  { id: 'avatar-04', label: 'Volt', emoji: '⚡' },
  { id: 'avatar-05', label: 'Ghost', emoji: '👻' },
  { id: 'avatar-06', label: 'Pilot', emoji: '🚀' },
  { id: 'avatar-07', label: 'Racer', emoji: '🏎️' },
  { id: 'avatar-08', label: 'Blade', emoji: '⚔️' },
  { id: 'avatar-09', label: 'Oracle', emoji: '👁️' },
  { id: 'avatar-10', label: 'Storm', emoji: '🌪️' },
  { id: 'avatar-11', label: 'Crown', emoji: '👑' },
  { id: 'avatar-12', label: 'Signal', emoji: '📡' }
];
const AVATAR_IDS = new Set(AVATARS.map(a => a.id));
const ACCENT_OK = /^#[0-9a-fA-F]{6}$/;

function defaultProfile(userId, username) {
  return {
    userId,
    displayName: username,
    bio: '',
    avatarId: 'avatar-01',
    accentColor: '#a855f7',
    updatedAt: new Date().toISOString()
  };
}
function defaultSettings(userId) {
  return {
    userId,
    profilePublic: true,
    updatedAt: new Date().toISOString()
  };
}

async function ensurePlayerProfile(userId, username) {
  if (pool) {
    await pool.query(
      `INSERT INTO user_profiles (user_id, display_name, bio, avatar_id, accent_color)
       VALUES ($1,$2,'','avatar-01','#a855f7') ON CONFLICT (user_id) DO NOTHING`,
      [userId, username]
    );
    await pool.query(
      `INSERT INTO user_settings (user_id, profile_public)
       VALUES ($1, TRUE) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
    const p = await pool.query('SELECT * FROM user_profiles WHERE user_id=$1', [userId]);
    const st = await pool.query('SELECT * FROM user_settings WHERE user_id=$1', [userId]);
    const pr = p.rows[0];
    const se = st.rows[0];
    return {
      profile: {
        userId: pr.user_id,
        displayName: pr.display_name,
        bio: pr.bio || '',
        avatarId: pr.avatar_id,
        accentColor: pr.accent_color,
        updatedAt: pr.updated_at
      },
      settings: {
        userId: se.user_id,
        profilePublic: se.profile_public,
        updatedAt: se.updated_at
      }
    };
  }
  if (!mem.profiles[userId]) mem.profiles[userId] = defaultProfile(userId, username);
  if (!mem.settings[userId]) mem.settings[userId] = defaultSettings(userId);
  return { profile: mem.profiles[userId], settings: mem.settings[userId] };
}

function publicProfilePayload(user, profile, settings, isOwner) {
  const avatar = AVATARS.find(a => a.id === profile.avatarId) || AVATARS[0];
  const base = {
    username: user.username,
    displayName: profile.displayName || user.username,
    bio: profile.bio || '',
    avatarId: profile.avatarId,
    avatarEmoji: avatar.emoji,
    avatarLabel: avatar.label,
    accentColor: profile.accentColor || '#a855f7',
    createdAt: user.createdAt || null,
    profilePublic: !!settings.profilePublic,
    // real activity only — localStorage stats are client-side; server has none yet
    stats: {
      gamesPlayed: 0,
      note: 'Play tracking will populate these when library sync is enabled.'
    },
    favourites: [],
    recentlyPlayed: []
  };
  if (isOwner) {
    base.email = user.email; // only to owner via /me
    base.isOwner = true;
  }
  return base;
}

app.get('/api/profile/avatars', (req, res) => {
  res.json({ success: true, data: AVATARS });
});

app.get('/api/profile/me', requirePlayer, async (req, res) => {
  try {
    let user = req.player;
    // load createdAt if needed
    if (pool) {
      const { rows } = await pool.query('SELECT id, username, email, role, created_at FROM users WHERE id=$1', [user.id]);
      if (!rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
      user = { id: rows[0].id, username: rows[0].username, email: rows[0].email, role: rows[0].role, createdAt: rows[0].created_at };
    } else {
      const u = mem.users.find(x => x.id === user.id);
      if (!u) return res.status(404).json({ success: false, error: 'User not found' });
      user = { id: u.id, username: u.username, email: u.email, role: u.role, createdAt: u.createdAt };
    }
    const { profile, settings } = await ensurePlayerProfile(user.id, user.username);
    res.json({
      success: true,
      data: {
        profile: publicProfilePayload(user, profile, settings, true),
        settings: { profilePublic: settings.profilePublic },
        csrf: req.playerSession.csrf
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to load profile' });
  }
});

app.put('/api/profile/me', requirePlayer, requirePlayerCsrf, async (req, res) => {
  try {
    const body = req.body || {};
    let displayName = body.displayName != null ? String(body.displayName).trim() : null;
    let bio = body.bio != null ? String(body.bio) : null;
    let avatarId = body.avatarId != null ? String(body.avatarId) : null;
    let accentColor = body.accentColor != null ? String(body.accentColor).trim() : null;

    if (displayName != null) {
      if (displayName.length < 2 || displayName.length > 32) {
        return res.status(400).json({ success: false, error: 'Display name must be 2–32 characters' });
      }
    }
    if (bio != null) {
      bio = bio.slice(0, 280);
    }
    if (avatarId != null && !AVATAR_IDS.has(avatarId)) {
      return res.status(400).json({ success: false, error: 'Invalid avatar' });
    }
    if (accentColor != null && !ACCENT_OK.test(accentColor)) {
      return res.status(400).json({ success: false, error: 'Accent colour must be a hex value like #a855f7' });
    }

    // never allow role changes via this route
    await ensurePlayerProfile(req.player.id, req.player.username);

    if (pool) {
      const fields = [];
      const vals = [];
      let i = 1;
      if (displayName != null) { fields.push(`display_name=$${i++}`); vals.push(displayName); }
      if (bio != null) { fields.push(`bio=$${i++}`); vals.push(bio); }
      if (avatarId != null) { fields.push(`avatar_id=$${i++}`); vals.push(avatarId); }
      if (accentColor != null) { fields.push(`accent_color=$${i++}`); vals.push(accentColor); }
      if (fields.length) {
        fields.push('updated_at=NOW()');
        vals.push(req.player.id);
        await pool.query(`UPDATE user_profiles SET ${fields.join(',')} WHERE user_id=$${i}`, vals);
      }
    } else {
      const p = mem.profiles[req.player.id];
      if (displayName != null) p.displayName = displayName;
      if (bio != null) p.bio = bio;
      if (avatarId != null) p.avatarId = avatarId;
      if (accentColor != null) p.accentColor = accentColor;
      p.updatedAt = new Date().toISOString();
    }

    // return updated
    req.url = '/api/profile/me';
    // reuse loader
    let user = req.player;
    if (pool) {
      const { rows } = await pool.query('SELECT id, username, email, role, created_at FROM users WHERE id=$1', [user.id]);
      user = { id: rows[0].id, username: rows[0].username, email: rows[0].email, role: rows[0].role, createdAt: rows[0].created_at };
    } else {
      const u = mem.users.find(x => x.id === user.id);
      user = { id: u.id, username: u.username, email: u.email, role: u.role, createdAt: u.createdAt };
    }
    const { profile, settings } = await ensurePlayerProfile(user.id, user.username);
    res.json({ success: true, data: { profile: publicProfilePayload(user, profile, settings, true), settings: { profilePublic: settings.profilePublic } } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

app.put('/api/profile/settings', requirePlayer, requirePlayerCsrf, async (req, res) => {
  try {
    const profilePublic = !!req.body?.profilePublic;
    await ensurePlayerProfile(req.player.id, req.player.username);
    if (pool) {
      await pool.query(
        `UPDATE user_settings SET profile_public=$1, updated_at=NOW() WHERE user_id=$2`,
        [profilePublic, req.player.id]
      );
    } else {
      mem.settings[req.player.id].profilePublic = profilePublic;
      mem.settings[req.player.id].updatedAt = new Date().toISOString();
    }
    res.json({ success: true, data: { profilePublic } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

app.get('/api/profile/:username', async (req, res) => {
  try {
    const uname = String(req.params.username || '').trim();
    if (!uname) return res.status(400).json({ success: false, error: 'Username required' });

    let user = null;
    if (pool) {
      const { rows } = await pool.query(
        'SELECT id, username, email, role, created_at FROM users WHERE lower(username)=lower($1)',
        [uname]
      );
      if (!rows[0]) return res.status(404).json({ success: false, error: 'Profile not found' });
      user = { id: rows[0].id, username: rows[0].username, email: rows[0].email, role: rows[0].role, createdAt: rows[0].created_at };
    } else {
      user = mem.users.find(u => u.username.toLowerCase() === uname.toLowerCase()) || null;
      if (!user) return res.status(404).json({ success: false, error: 'Profile not found' });
      user = { id: user.id, username: user.username, email: user.email, role: user.role, createdAt: user.createdAt };
    }

    const { profile, settings } = await ensurePlayerProfile(user.id, user.username);

    // ownership check
    let isOwner = false;
    try {
      const session = await getPlayerSession(req);
      if (session && session.user.id === user.id) isOwner = true;
    } catch {}

    if (!settings.profilePublic && !isOwner) {
      return res.status(403).json({
        success: false,
        error: 'This profile is private',
        data: { username: user.username, profilePublic: false }
      });
    }

    const payload = publicProfilePayload(user, profile, settings, isOwner);
    if (!isOwner) {
      delete payload.email;
      payload.isOwner = false;
    }
    res.json({ success: true, data: payload });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to load profile' });
  }
});


app.post('/api/admin/login', loginLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password required' });
    let admin = null;
    if (pool) {
      const { rows } = await pool.query('SELECT * FROM admins WHERE email=$1', [email]);
      admin = rows[0] ? { id: rows[0].id, email: rows[0].email, passwordHash: rows[0].password_hash, displayName: rows[0].display_name, role: rows[0].role } : null;
    } else admin = mem.admins.find(a => a.email === email) || null;
    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) return res.status(401).json({ success: false, error: 'Invalid credentials' });
    const sid = crypto.randomBytes(32).toString('hex');
    const csrf = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + SESSION_TTL_MS);
    if (pool) await pool.query('INSERT INTO admin_sessions (id, admin_id, csrf_token, expires_at) VALUES ($1,$2,$3,$4)', [sid, admin.id, csrf, expires.toISOString()]);
    else mem.sessions.set(sid, { adminId: admin.id, csrf, expires: expires.getTime() });
    setSessionCookie(res, sid);
    logActivity(admin.id, 'admin.login', { email: admin.email });
    res.json({ success: true, data: { admin: { id: admin.id, email: admin.email, displayName: admin.displayName, role: admin.role }, csrf } });
  } catch (err) { console.error(err); res.status(500).json({ success: false, error: 'Login failed' }); }
});

app.post('/api/admin/logout', requireAdmin, requireCsrf, async (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (pool && sid) await pool.query('DELETE FROM admin_sessions WHERE id=$1', [sid]);
  else if (sid) mem.sessions.delete(sid);
  clearSessionCookie(res);
  logActivity(req.admin.id, 'admin.logout', {});
  res.json({ success: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ success: true, data: { admin: req.admin, csrf: req.adminSession.csrf } });
});

app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
  res.json({ success: true, data: {
    stats: { games: mem.games.length, published: mem.games.filter(g => g.published).length, requests: mem.requests.length, pendingRequests: mem.requests.filter(r => r.status === 'pending').length, underReview: mem.requests.filter(r => r.status === 'under_review').length, announcements: mem.announcements.length, activityCount: mem.activity.length },
    recentRequests: mem.requests.slice(0, 5).map(publicRequestShape),
    recentActivity: mem.activity.slice(0, 10)
  }});
});

function publicRequestShape(r) {
  return { id: r.id, title: r.title, description: r.description, type: r.type, playerName: r.playerName, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

app.get('/api/admin/requests', requireAdmin, (req, res) => {
  let list = [...mem.requests];
  const { status, type, search } = req.query;
  if (status) list = list.filter(r => r.status === status);
  if (type) list = list.filter(r => r.type === type);
  if (search) { const q = String(search).toLowerCase(); list = list.filter(r => r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || (r.playerName || '').toLowerCase().includes(q)); }
  res.json({ success: true, count: list.length, data: list.map(publicRequestShape) });
});

app.get('/api/admin/requests/:id', requireAdmin, (req, res) => {
  const r = mem.requests.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ success: false, error: 'Not found' });
  const notes = mem.requestNotes.filter(n => n.requestId === r.id).map(n => ({ id: n.id, body: n.body, adminId: n.adminId, createdAt: n.createdAt }));
  res.json({ success: true, data: { ...publicRequestShape(r), notes } });
});

app.put('/api/admin/requests/:id', requireAdmin, requireCsrf, (req, res) => {
  const r = mem.requests.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ success: false, error: 'Not found' });
  const allowed = ['pending', 'under_review', 'approved', 'rejected', 'completed'];
  if (req.body?.status && allowed.includes(req.body.status)) { r.status = req.body.status; r.updatedAt = new Date().toISOString(); logActivity(req.admin.id, 'request.status', { requestId: r.id, status: r.status }); }
  res.json({ success: true, data: publicRequestShape(r) });
});

app.post('/api/admin/requests/:id/notes', requireAdmin, requireCsrf, (req, res) => {
  const r = mem.requests.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ success: false, error: 'Not found' });
  const body = String(req.body?.body || '').trim().slice(0, 4000);
  if (!body) return res.status(400).json({ success: false, error: 'Note body required' });
  const note = { id: uuidv4(), requestId: r.id, adminId: req.admin.id, body, createdAt: new Date().toISOString() };
  mem.requestNotes.push(note); r.updatedAt = new Date().toISOString();
  logActivity(req.admin.id, 'request.note', { requestId: r.id });
  res.status(201).json({ success: true, data: { id: note.id, body: note.body, createdAt: note.createdAt } });
});

app.get('/api/admin/games', requireAdmin, (req, res) => { res.json({ success: true, data: mem.games }); });

app.put('/api/admin/games/:id', requireAdmin, requireCsrf, (req, res) => {
  const g = mem.games.find(x => x.id === req.params.id);
  if (!g) return res.status(404).json({ success: false, error: 'Not found' });
  for (const key of ['title', 'shortDescription', 'description', 'genre', 'status', 'version', 'featured', 'sortOrder']) {
    if (req.body[key] !== undefined) g[key] = req.body[key];
  }
  for (const key of ['thumbnail', 'banner', 'gameUrl']) {
    if (req.body[key] !== undefined) {
      const val = String(req.body[key]);
      if (val.startsWith('/games/') && !val.includes('..')) g[key] = val;
    }
  }
  logActivity(req.admin.id, 'game.update', { gameId: g.id });
  res.json({ success: true, data: g });
});

app.post('/api/admin/games/:id/publish', requireAdmin, requireCsrf, (req, res) => {
  const g = mem.games.find(x => x.id === req.params.id);
  if (!g) return res.status(404).json({ success: false, error: 'Not found' });
  const filePath = path.join(__dirname, (g.gameUrl || '').replace(/^\//, ''));
  if (!g.gameUrl || !fs.existsSync(filePath)) return res.status(400).json({ success: false, error: 'Cannot publish: launch file missing' });
  if (!g.title || !g.genre) return res.status(400).json({ success: false, error: 'Title and genre required' });
  g.published = true; if (g.status === 'in_development') g.status = 'available';
  logActivity(req.admin.id, 'game.publish', { gameId: g.id });
  res.json({ success: true, data: g });
});

app.post('/api/admin/games/:id/unpublish', requireAdmin, requireCsrf, (req, res) => {
  const g = mem.games.find(x => x.id === req.params.id);
  if (!g) return res.status(404).json({ success: false, error: 'Not found' });
  g.published = false; logActivity(req.admin.id, 'game.unpublish', { gameId: g.id });
  res.json({ success: true, data: g });
});

app.post('/api/admin/games/:id/archive', requireAdmin, requireCsrf, (req, res) => {
  const g = mem.games.find(x => x.id === req.params.id);
  if (!g) return res.status(404).json({ success: false, error: 'Not found' });
  g.published = false; g.status = 'unavailable';
  logActivity(req.admin.id, 'game.archive', { gameId: g.id });
  res.json({ success: true, data: g });
});

app.get('/api/admin/players', requireAdmin, (req, res) => {
  res.json({ success: true, data: mem.players, message: 'Player accounts appear when public auth is enabled.' });
});

app.get('/api/admin/activity', requireAdmin, (req, res) => {
  res.json({ success: true, data: mem.activity.slice(0, 100) });
});

app.get('/api/admin/announcements', requireAdmin, (req, res) => {
  res.json({ success: true, data: mem.announcements });
});

app.post('/api/admin/announcements', requireAdmin, requireCsrf, (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 200);
  const body = String(req.body?.body || '').trim().slice(0, 5000);
  if (!title || !body) return res.status(400).json({ success: false, error: 'title and body required' });
  const row = { id: uuidv4(), title, body, published: !!req.body.published, createdAt: new Date().toISOString() };
  mem.announcements.unshift(row);
  logActivity(req.admin.id, 'announcement.create', { id: row.id });
  res.status(201).json({ success: true, data: row });
});

app.get(['/admin', '/admin/*'], (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
app.get(['/', '/discover', '/library', '/recent', '/profile', '/settings', '/play/:id'], (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

initDb().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RIFTTED REALITIES v0.3 — http://localhost:${PORT} · Admin http://localhost:${PORT}/admin`);
  });
});
