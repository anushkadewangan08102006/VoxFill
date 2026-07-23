/**
 * VoxFill Auth Portal
 *
 * Small standalone Node server for signup, signin, session handling, and
 * protected downloads. It deliberately lives outside the extension repo and
 * uses only built-in Node modules so a teammate can push or deploy it alone.
 */
const crypto = require('crypto');
const fs = require('fs/promises');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const DOWNLOAD_FILE = path.join(ROOT_DIR, 'downloads', 'voxfill-extension.zip');
const SESSION_COOKIE = 'voxfill_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.zip': 'application/zip',
};

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(path.join(ROOT_DIR, 'downloads'), { recursive: true });
  await ensureJsonFile(USERS_FILE, []);
  await ensureJsonFile(SESSIONS_FILE, {});
}

async function ensureJsonFile(filePath, defaultValue) {
  try {
    await fs.access(filePath);
  } catch (error) {
    await fs.writeFile(filePath, JSON.stringify(defaultValue, null, 2));
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  const cookies = {};
  const rawCookie = req.headers.cookie || '';

  rawCookie.split(';').forEach((cookie) => {
    const [name, ...valueParts] = cookie.trim().split('=');
    if (!name) return;
    cookies[name] = decodeURIComponent(valueParts.join('='));
  });

  return cookies;
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 32) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Invalid JSON request body.'));
      }
    });

    req.on('error', reject);
  });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateAuthInput(name, email, password, requireName) {
  const normalizedEmail = normalizeEmail(email);

  if (requireName && String(name || '').trim().length < 2) {
    return 'Name must be at least 2 characters.';
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return 'Enter a valid email address.';
  }

  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters.';
  }

  return null;
}

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPassword(password, storedHash) {
  return new Promise((resolve, reject) => {
    const [salt, key] = String(storedHash || '').split(':');
    if (!salt || !key) {
      resolve(false);
      return;
    }

    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      const storedKey = Buffer.from(key, 'hex');
      const candidateKey = Buffer.from(derivedKey.toString('hex'), 'hex');

      if (storedKey.length !== candidateKey.length) {
        resolve(false);
        return;
      }

      resolve(crypto.timingSafeEqual(storedKey, candidateKey));
    });
  });
}

async function createSession(userId) {
  const sessions = await readJson(SESSIONS_FILE, {});
  const token = crypto.randomBytes(32).toString('hex');

  sessions[token] = {
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  await writeJson(SESSIONS_FILE, sessions);
  return token;
}

async function getCurrentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;

  const sessions = await readJson(SESSIONS_FILE, {});
  const session = sessions[token];

  if (!session || session.expiresAt < Date.now()) {
    delete sessions[token];
    await writeJson(SESSIONS_FILE, sessions);
    return null;
  }

  const users = await readJson(USERS_FILE, []);
  const user = users.find((candidate) => candidate.id === session.userId);
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

async function handleSignup(req, res) {
  const body = await readRequestBody(req);
  const error = validateAuthInput(body.name, body.email, body.password, true);

  if (error) {
    sendJson(res, 400, { success: false, error });
    return;
  }

  const users = await readJson(USERS_FILE, []);
  const email = normalizeEmail(body.email);

  if (users.some((user) => user.email === email)) {
    sendJson(res, 409, { success: false, error: 'An account with this email already exists.' });
    return;
  }

  const user = {
    id: crypto.randomUUID(),
    name: String(body.name).trim(),
    email,
    passwordHash: await hashPassword(body.password),
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  await writeJson(USERS_FILE, users);

  const token = await createSession(user.id);
  setSessionCookie(res, token);

  sendJson(res, 201, {
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
  });
}

async function handleSignin(req, res) {
  const body = await readRequestBody(req);
  const error = validateAuthInput('', body.email, body.password, false);

  if (error) {
    sendJson(res, 400, { success: false, error });
    return;
  }

  const users = await readJson(USERS_FILE, []);
  const email = normalizeEmail(body.email);
  const user = users.find((candidate) => candidate.email === email);

  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    sendJson(res, 401, { success: false, error: 'Invalid email or password.' });
    return;
  }

  const token = await createSession(user.id);
  setSessionCookie(res, token);

  sendJson(res, 200, {
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
  });
}

async function handleSignout(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  const sessions = await readJson(SESSIONS_FILE, {});

  if (token && sessions[token]) {
    delete sessions[token];
    await writeJson(SESSIONS_FILE, sessions);
  }

  clearSessionCookie(res);
  sendJson(res, 200, { success: true });
}

async function serveDownload(req, res) {
  const user = await getCurrentUser(req);
  if (!user) {
    sendJson(res, 401, {
      success: false,
      error: 'Please sign in to download VoxFill.',
    });
    return;
  }

  try {
    const stat = await fs.stat(DOWNLOAD_FILE);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES['.zip'],
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="voxfill-extension.zip"',
      'Cache-Control': 'no-store',
    });
    const file = await fs.open(DOWNLOAD_FILE, 'r');
    file.createReadStream().pipe(res);
  } catch (error) {
    sendJson(res, 404, {
      success: false,
      error: 'Extension package is not available yet. Run npm run package-extension first.',
    });
  }
}

async function serveStatic(req, res, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { success: false, error: 'Forbidden.' });
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const extension = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
      'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=3600',
    });
    res.end(file);
  } catch (error) {
    res.writeHead(302, { Location: '/' });
    res.end();
  }
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'POST' && pathname === '/api/signup') {
      await handleSignup(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/signin') {
      await handleSignin(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/signout') {
      await handleSignout(req, res);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/me') {
      const user = await getCurrentUser(req);
      sendJson(res, 200, { success: true, user });
      return;
    }

    if (req.method === 'GET' && pathname === '/download/voxfill-extension.zip') {
      await serveDownload(req, res);
      return;
    }

    if (req.method === 'GET') {
      await serveStatic(req, res, pathname);
      return;
    }

    sendJson(res, 405, { success: false, error: 'Method not allowed.' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { success: false, error: error.message || 'Unexpected server error.' });
  }
}

ensureStorage().then(() => {
  http.createServer(handleRequest).listen(PORT, '127.0.0.1', () => {
    console.log(`VoxFill Auth Portal running at http://localhost:${PORT}`);
  });
});
