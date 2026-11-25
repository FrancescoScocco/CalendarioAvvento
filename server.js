'use strict';

// Zero dipendenze esterne: avvia con "node server.js" (Node 20+).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const ROOT = __dirname;
// I file del sito (index/app/style) stanno in root per GitHub Pages; public/ resta un mirror.
const PUBLIC_DIR = ROOT;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const DATA_FILE = path.join(DATA_DIR, 'calendar.json');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');
const PASSWORD_FILE = path.join(DATA_DIR, 'admin-password.txt');
const STATIC_DENY = [
  /^\/server\.js$/i,
  /^\/package\.json$/i,
  /^\/\.env(?:\.example)?$/i,
  /^\/\.git(?:\/|$)/i,
  /^\/test(?:\/|$)/i,
  /^\/node_modules(?:\/|$)/i,
  /^\/data\/admin-password\.txt$/i,
  /^\/data\/calendar\.json$/i,
  /^\/uploads(?:\/|$)/i
];

// Piccolo lettore .env per rendere l'avvio facile anche senza librerie aggiuntive.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
// Attivo di default: le caselle future restano nascoste. Usa LOCK_BY_DATE=0 solo in prova.
const LOCK_BY_DATE = process.env.LOCK_BY_DATE !== '0';
const EVENT_YEAR = Number(process.env.EVENT_YEAR) || 2026;
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();
const badLogins = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

let adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  if (fs.existsSync(PASSWORD_FILE)) {
    adminPassword = fs.readFileSync(PASSWORD_FILE, 'utf8').trim();
  } else {
    adminPassword = crypto.randomBytes(12).toString('base64url');
    fs.writeFileSync(PASSWORD_FILE, `${adminPassword}\n`, { mode: 0o600 });
  }
}

function saveCalendar(calendar) {
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(calendar, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
  try { exportStaticCalendar(calendar); } catch (e) {
    console.warn('[calendar] export static non riuscito:', e.message);
  }
}

function loadCalendar() {
  if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const initial = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')).map((song) => ({
    ...song, type: song.type || 'song', audioFile: null, openedAt: null
  }));
  saveCalendar(initial);
  return initial;
}

let calendar = loadCalendar();

function json(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(body);
}

function err(res, status, message) { json(res, status, { error: message }); }

function readBody(req, maxBytes = 100_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Payload troppo grande'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buffer = await readBody(req);
  try { return JSON.parse(buffer.toString('utf8')); }
  catch { throw Object.assign(new Error('JSON non valido'), { status: 400 }); }
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((part) => {
    const i = part.indexOf('=');
    return i < 0 ? ['', ''] : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
  }).filter(([k]) => k));
}

function isAdmin(req) {
  const token = cookies(req).advent_admin;
  const expires = token && sessions.get(token);
  if (!expires) return false;
  if (expires < Date.now()) { sessions.delete(token); return false; }
  return true;
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  err(res, 401, 'Accedi come organizzatore per eseguire questa operazione.');
  return false;
}

function cookieHeader(token, maxAge, req) {
  // Su HTTPS aggiunge Secure (il proxy può impostare X-Forwarded-Proto).
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  return `advent_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // curl / tool CLI
  try {
    const u = new URL(origin);
    return u.host === req.headers.host && (u.protocol === 'http:' || u.protocol === 'https:');
  } catch { return false; }
}

function romeDate() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  return Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
}

function isUnlocked(day) {
  // La data odierna (Europe/Rome) decide sempre: openedAt non sblocca in anticipo.
  if (!LOCK_BY_DATE) return true;
  const { year, month, day: today } = romeDate();
  if (year > EVENT_YEAR) return true;
  if (year < EVENT_YEAR) return false;
  return month === 12 && today >= day;
}

function publicDoor(d) {
  const unlocked = isUnlocked(d.day);
  // Giorni futuri: la card resta visibile, ma senza contenuto apribile/spoiler.
  if (!unlocked) {
    return {
      day: d.day,
      title: null,
      artist: null,
      type: d.type === 'finale' ? 'finale' : 'song',
      opened: false,
      openedAt: null,
      unlocked: false,
      slogan: null,
      youtubeId: '',
      audioUrl: null,
      hasMedia: false
    };
  }
  const opened = Boolean(d.openedAt);
  return {
    day: d.day,
    title: d.title,
    artist: d.artist,
    type: d.type,
    opened,
    openedAt: d.openedAt,
    unlocked: true,
    // Lo slogan è restituito soltanto quando la casella è stata aperta.
    slogan: opened ? d.slogan : null,
    youtubeId: d.youtubeId || '',
    audioUrl: d.audioFile ? `/media/${encodeURIComponent(d.audioFile)}` : null,
    hasMedia: Boolean(d.audioFile || d.youtubeId)
  };
}

function exportStaticCalendar(list) {
  // Dati pubblici per GitHub Pages: titoli/slogan/youtube, senza aperture né audio locali.
  const payload = list.map((d) => ({
    day: d.day,
    title: d.title,
    artist: d.artist || '',
    youtubeId: d.youtubeId || '',
    slogan: d.slogan || '',
    type: d.type || 'song',
    audioFile: null,
    openedAt: null
  }));
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(path.join(ROOT, 'calendar-data.json'), text, 'utf8');
  const publicMirror = path.join(ROOT, 'public', 'calendar-data.json');
  if (fs.existsSync(path.dirname(publicMirror))) {
    fs.writeFileSync(publicMirror, text, 'utf8');
  }
}

function dayRecord(day) {
  return Number.isInteger(day) && day >= 1 && day <= 24
    ? calendar.find((d) => d.day === day)
    : null;
}

function parseYouTubeId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    let id;
    if (host === 'youtu.be') id = u.pathname.split('/')[1];
    if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else if (/^\/(embed|shorts|live)\//.test(u.pathname)) id = u.pathname.split('/')[2];
    }
    if (/^[A-Za-z0-9_-]{11}$/.test(id || '')) return id;
  } catch { /* non è URL */ }
  return null;
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav'
};

function serveFile(req, res, filename, isMedia = false) {
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) return err(res, 404, 'File non trovato.');
  const stat = fs.statSync(filename);
  const mime = mimeTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream';
  const headers = {
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    'Cache-Control': isMedia ? 'private, max-age=3600' : 'no-cache'
  };
  const range = req.headers.range;
  if (range && isMedia) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start <= end && end < stat.size) {
        res.writeHead(206, {
          ...headers, 'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`
        });
        fs.createReadStream(filename, { start, end }).pipe(res);
        return;
      }
    }
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    res.end();
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  fs.createReadStream(filename).pipe(res);
}

async function router(req, res) {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(u.pathname);
  const method = req.method;
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && !sameOrigin(req)) {
    return err(res, 403, 'Origine della richiesta non valida.');
  }

  if (method === 'GET' && pathname === '/api/calendar') {
    // Tutte le card restano in griglia; quelle future arrivano senza contenuto.
    const { year, month, day: today } = romeDate();
    return json(res, 200, {
      doors: calendar.map(publicDoor),
      openedSongs: calendar.filter(d => d.type === 'song' && d.openedAt).length,
      totalSongs: 23,
      lockByDate: LOCK_BY_DATE,
      eventYear: EVENT_YEAR,
      today: { year, month, day: today }
    });
  }

  const opening = pathname.match(/^\/api\/doors\/(\d+)\/open$/);
  if (method === 'POST' && opening) {
    const door = dayRecord(Number(opening[1]));
    if (!door) return err(res, 404, 'Casella inesistente.');
    if (!isUnlocked(door.day)) {
      return err(res, 403, `La casella ${door.day} sarà disponibile dal ${door.day} dicembre ${EVENT_YEAR}.`);
    }
    if (!door.openedAt) {
      door.openedAt = new Date().toISOString();
      saveCalendar(calendar);
    }
    return json(res, 200, { door: publicDoor(door) });
  }

  if (method === 'POST' && pathname === '/api/admin/login') {
    const ip = req.socket.remoteAddress || 'unknown';
    const info = badLogins.get(ip) || { count: 0, until: Date.now() + 15 * 60_000 };
    if (Date.now() > info.until) { info.count = 0; info.until = Date.now() + 15 * 60_000; }
    if (info.count >= 8) return err(res, 429, 'Troppi tentativi: riprova tra 15 minuti.');
    const body = await readJson(req);
    const got = crypto.createHash('sha256').update(String(body.password || '')).digest();
    const expected = crypto.createHash('sha256').update(adminPassword).digest();
    if (!crypto.timingSafeEqual(got, expected)) {
      info.count++; badLogins.set(ip, info);
      return err(res, 401, 'Password errata.');
    }
    badLogins.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_DURATION_MS);
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(token, 86400, req) });
  }

  if (method === 'GET' && pathname === '/api/admin/me') {
    return json(res, 200, { loggedIn: isAdmin(req) });
  }

  if (method === 'POST' && pathname === '/api/admin/logout') {
    sessions.delete(cookies(req).advent_admin);
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0, req) });
  }

  if (method === 'GET' && pathname === '/api/admin/doors') {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, { doors: calendar });
  }

  const edit = pathname.match(/^\/api\/admin\/doors\/(\d+)$/);
  if (method === 'PATCH' && edit) {
    if (!requireAdmin(req, res)) return;
    const door = dayRecord(Number(edit[1]));
    if (!door) return err(res, 404, 'Casella non trovata.');
    const body = await readJson(req);
    // Prima valida tutti i campi, poi aggiorna: evita salvataggi parziali.
    for (const [field, max] of [['title', 100], ['artist', 100], ['slogan', 500]]) {
      if (body[field] !== undefined && (typeof body[field] !== 'string' || body[field].length > max))
        return err(res, 400, `Il campo ${field} deve essere testo di massimo ${max} caratteri.`);
    }
    const id = body.youtubeUrl !== undefined ? parseYouTubeId(body.youtubeUrl) : undefined;
    if (id === null) return err(res, 400, 'Inserisci un URL YouTube valido o un ID video di 11 caratteri.');
    for (const field of ['title', 'artist', 'slogan']) {
      if (body[field] !== undefined) door[field] = body[field].trim();
    }
    if (id !== undefined) door.youtubeId = id; // L'audio caricato resta prioritario.
    saveCalendar(calendar);
    return json(res, 200, { door });
  }

  const audio = pathname.match(/^\/api\/admin\/doors\/(\d+)\/audio$/);
  if (audio && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const door = dayRecord(Number(audio[1]));
    if (!door || door.type === 'finale') return err(res, 404, 'Brano non trovato.');
    const original = String(req.headers['x-file-name'] || '');
    const ext = path.extname(original).toLowerCase();
    if (!['.mp3', '.m4a', '.ogg', '.wav'].includes(ext))
      return err(res, 400, 'Usa un file MP3, M4A, OGG o WAV.');
    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > MAX_AUDIO_BYTES) return err(res, 413, 'Il file supera i 30 MB.');
    const bytes = await readBody(req, MAX_AUDIO_BYTES);
    if (!bytes.length) return err(res, 400, 'Il file è vuoto.');
    const filename = `${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), bytes);
    const previous = door.audioFile;
    door.audioFile = filename;
    saveCalendar(calendar);
    if (previous) { try { fs.unlinkSync(path.join(UPLOADS_DIR, previous)); } catch {} }
    return json(res, 200, { door });
  }

  if (audio && method === 'DELETE') {
    if (!requireAdmin(req, res)) return;
    const door = dayRecord(Number(audio[1]));
    if (!door) return err(res, 404, 'Casella non trovata.');
    const previous = door.audioFile;
    door.audioFile = null;
    saveCalendar(calendar);
    if (previous) { try { fs.unlinkSync(path.join(UPLOADS_DIR, previous)); } catch {} }
    return json(res, 200, { door });
  }

  if (method === 'GET' && pathname.startsWith('/media/')) {
    const name = pathname.slice('/media/'.length);
    // Solo file di caselle esistenti e già sbloccate (niente spoiler sui giorni futuri).
    const owner = calendar.find((d) => d.audioFile === name);
    if (name !== path.basename(name) || !owner || !isUnlocked(owner.day))
      return err(res, 404, 'Audio non trovato.');
    return serveFile(req, res, path.join(UPLOADS_DIR, name), true);
  }

  if (method === 'GET' && !pathname.startsWith('/api/')) {
    const location = pathname === '/' ? '/index.html' : pathname;
    if (STATIC_DENY.some((re) => re.test(location))) return err(res, 404, 'Risorsa non trovata.');
    const target = path.resolve(PUBLIC_DIR, '.' + location);
    const allowedRoot = target === PUBLIC_DIR || target.startsWith(PUBLIC_DIR + path.sep);
    if (allowedRoot && fs.existsSync(target) && fs.statSync(target).isFile())
      return serveFile(req, res, target);
    // Compatibilità: eventuale mirror in /public
    const legacy = path.resolve(ROOT, 'public', '.' + location.replace(/^\/public/, ''));
    if (legacy.startsWith(path.join(ROOT, 'public') + path.sep) && fs.existsSync(legacy) && fs.statSync(legacy).isFile())
      return serveFile(req, res, legacy);
  }
  return err(res, 404, 'Risorsa non trovata.');
}

const server = http.createServer((req, res) => {
  router(req, res).catch((e) => {
    console.error('[HTTP]', e);
    if (!res.headersSent && !res.destroyed) err(res, e.status || 500, e.status ? e.message : 'Errore del server.');
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`\n🎄 Calendario musicale → http://${HOST}:${PORT}`);
    console.log(`🔐 Password organizzatore: ${process.env.ADMIN_PASSWORD ? '(definita in .env)' : adminPassword}`);
    console.log(`📁 Aperture e slogan salvati in ${DATA_FILE}`);
    console.log(`📅 Blocco per data: ${LOCK_BY_DATE ? `attivo (${EVENT_YEAR})` : 'disattivato (modalità prova)'}\n`);
  });
}

module.exports = { server, parseYouTubeId, publicDoor, isUnlocked };
