import { generateBracket, exportOBJ, exportSTL, GENERATOR_VERSION, GeometryValidationError } from '../shared/geometry.js';
import { generateBrandAsset, DesignerValidationError } from '../shared/designer.js';

const COOKIE = '__Host-conseiv_session';
const MAX_BODY = 16_384;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_PER_KEY = 10;
class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new HttpError(status, code, message); };
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });

async function bodyJson(request, allowed) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) fail(415, 'JSON_REQUIRED', 'Send application/json.');
  if (Number(request.headers.get('Content-Length')) > MAX_BODY) fail(413, 'BODY_TOO_LARGE', 'Request exceeds 16 KiB.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'INVALID_JSON', 'A JSON object is required.');
  const decoder = new TextDecoder();
  let text = '', length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BODY) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE', 'Request exceeds 16 KiB.'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  let body;
  try { body = JSON.parse(text); } catch { fail(400, 'INVALID_JSON', 'Invalid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'INVALID_BODY', 'A JSON object is required.');
  for (const key of Object.keys(body)) if (!allowed.includes(key)) fail(400, 'UNKNOWN_FIELD', `Unknown field: ${key}.`);
  return body;
}

function sameOrigin(request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) fail(403, 'ORIGIN_REJECTED', 'Use this application to submit the request.');
}
function dbFor(env) { if (!env.DB) fail(503, 'DATABASE_UNAVAILABLE', 'Saved designs are temporarily unavailable.'); return env.DB; }
function cookieToken(request) {
  const entry = (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`));
  return entry?.slice(COOKIE.length + 1) || '';
}
async function hash(token) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
function setCookie(token, age = 3600) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
}
async function authCall(env, path, options = {}) {
  const origin = env.AUTHFOR_ORIGIN || 'https://authfor.com';
  if (origin !== 'https://authfor.com') fail(503, 'AUTH_CONFIGURATION', 'Authentication provider is not configured.');
  let response;
  try {
    // AUTHFOR is injectable only as a test/service transport; production uses the verified public contract.
    const request = new Request(origin + path, { ...options, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    response = env.AUTHFOR ? await env.AUTHFOR.fetch(request) : await fetch(request);
  } catch { fail(503, 'AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable.'); }
  if (response.status >= 300 && response.status < 400) fail(502, 'AUTH_REDIRECT_REJECTED', 'Authentication returned an unexpected redirect.');
  let data;
  try { data = await response.json(); } catch { fail(502, 'AUTH_INVALID_RESPONSE', 'Authentication returned an invalid response.'); }
  if (!response.ok) {
    if (response.status >= 500 || response.status === 429) fail(503, 'AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable.');
    fail(response.status === 401 ? 401 : 400, 'AUTH_REJECTED', 'Sign-in or registration was not accepted. Check your details.');
  }
  return data;
}
function userFields(value) {
  if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 200 || typeof value.email !== 'string' || typeof value.name !== 'string') {
    fail(502, 'AUTH_INVALID_RESPONSE', 'Authentication did not return a valid user.');
  }
  return { id: value.id, email: value.email, name: value.name };
}
async function enforceRateLimit(db, keys) {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const key of keys) {
    await db.prepare('DELETE FROM auth_attempts WHERE bucket_key=? AND attempted_at<?').bind(key, cutoff).run();
    const row = await db.prepare('SELECT COUNT(*) AS count FROM auth_attempts WHERE bucket_key=?').bind(key).first();
    if (row.count >= RATE_LIMIT_MAX_PER_KEY) fail(429, 'RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.');
  }
  const now = Date.now();
  await db.batch(keys.map(key => db.prepare('INSERT INTO auth_attempts (bucket_key,attempted_at) VALUES (?,?)').bind(key, now)));
}
async function storeUser(db, user) {
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO users (id,email,name,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,updated_at=excluded.updated_at')
    .bind(user.id, user.email, user.name, now, now).run();
}
async function authenticate(request, env) {
  const bearer = request.headers.get('Authorization');
  if (bearer && !bearer.startsWith('Bearer ')) fail(401, 'INVALID_AUTHORIZATION', 'Use a Bearer token.');
  const token = bearer ? bearer.slice(7) : cookieToken(request);
  if (!token || token.length > 8192) fail(401, 'SIGN_IN_REQUIRED', 'Sign in to save and open designs.');
  const db = dbFor(env);
  let session;
  if (!bearer) {
    session = await db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').bind(await hash(token), Date.now()).first();
    if (!session) fail(401, 'SESSION_EXPIRED', 'Your session expired. Sign in again.');
  }
  const user = userFields(await authCall(env, '/api/v1/verify', { headers: { Authorization: `Bearer ${token}` } }));
  if (session && session.user_id !== user.id) fail(401, 'SESSION_MISMATCH', 'Sign in again.');
  await storeUser(db, user);
  return user;
}
function assetFields(row) {
  return { id: row.id, name: row.name, parameters: JSON.parse(row.parameters_json), generatorVersion: row.generator_version, createdAt: row.created_at, updatedAt: row.updated_at };
}
async function saveAsset(request, env, body, generation) {
  sameOrigin(request);
  const user = await authenticate(request, env);
  const name = body.name === undefined ? 'Mounting bracket' : body.name;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) fail(400, 'INVALID_NAME', 'Name must contain 1 to 100 characters.');
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const db = dbFor(env);
  const result = await db.prepare('INSERT INTO assets (id,owner_id,name,parameters_json,geometry_json,generator_version,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM assets WHERE owner_id=?) < 100')
    .bind(id, user.id, name.trim(), JSON.stringify(generation.parameters), JSON.stringify(generation), GENERATOR_VERSION, now, now, user.id).run();
  if (!result.meta.changes) fail(409, 'LIBRARY_FULL', 'Your library holds 100 designs. Remove a design before saving another.');
  return { id, name: name.trim(), parameters: generation.parameters, generatorVersion: GENERATOR_VERSION, createdAt: now, updatedAt: now };
}

async function route(request, env) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (path === '/api/health' && method === 'GET') {
    await dbFor(env).prepare('SELECT id FROM users LIMIT 1').all();
    return json({ ok: true, service: 'conseiv', generatorVersion: GENERATOR_VERSION, database: 'ok' });
  }
  if (['/api/auth/register', '/api/auth/login'].includes(path) && method === 'POST') {
    sameOrigin(request);
    const db = dbFor(env);
    const body = await bodyJson(request, ['email', 'password', 'name']);
    if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length > 254 || typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 256) fail(400, 'INVALID_CREDENTIALS', 'Enter an email and a password of 8 to 256 characters.');
    if (path.endsWith('register') && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100)) fail(400, 'INVALID_NAME', 'A name of 1 to 100 characters is required.');
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    await enforceRateLimit(db, [`ip:${ip}`, `email:${body.email.toLowerCase()}`]);
    const data = await authCall(env, path.replace('/api/auth/', '/api/v1/'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, client_id: 'conseiv', venture_id: 'conseiv.com' }) });
    if (data.mfa_required) fail(409, 'MFA_REQUIRED', 'Complete sign-in with AuthFor; this studio does not yet handle MFA challenges.');
    if (typeof data.token !== 'string' || !/^[A-Za-z0-9_.-]{10,8192}$/.test(data.token)) fail(502, 'AUTH_INVALID_RESPONSE', 'Authentication did not return a valid session.');
    const user = userFields(await authCall(env, '/api/v1/verify', { headers: { Authorization: `Bearer ${data.token}` } }));
    await storeUser(db, user);
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE expires_at<=? OR user_id=?').bind(Date.now(), user.id),
      db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').bind(await hash(data.token), user.id, Date.now() + 3_600_000, new Date().toISOString()),
    ]);
    return json({ ok: true, user }, 200, { 'Set-Cookie': setCookie(data.token) });
  }
  if (path === '/api/auth/me' && method === 'GET') return json({ ok: true, user: await authenticate(request, env) });
  if (path === '/api/auth/logout' && method === 'POST') {
    sameOrigin(request);
    const token = cookieToken(request);
    if (token) await dbFor(env).prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': setCookie('', 0) });
  }
  if (path === '/api/conseiv/cad-mesh-generation' && method === 'POST') {
    const body = await bodyJson(request, ['parameters', 'save', 'name']);
    if (body.save !== undefined && typeof body.save !== 'boolean') fail(400, 'INVALID_SAVE', 'save must be a boolean.');
    const generation = generateBracket(body.parameters ?? {});
    const asset = body.save ? await saveAsset(request, env, body, generation) : undefined;
    return json({ ok: true, ...generation, ...(asset ? { asset } : {}) }, asset ? 201 : 200);
  }
  if (path === '/api/conseiv/assets' && method === 'POST') {
    const body = await bodyJson(request, ['parameters', 'name']);
    const generation = generateBracket(body.parameters ?? {});
    return json({ ok: true, asset: await saveAsset(request, env, body, generation), generation }, 201);
  }
  if (path === '/api/conseiv/assets' && method === 'GET') {
    const user = await authenticate(request, env);
    const limit = Number(url.searchParams.get('limit') || 20), offset = Number(url.searchParams.get('offset') || 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 10000) fail(400, 'INVALID_PAGE', 'Invalid page bounds.');
    const { results } = await dbFor(env).prepare('SELECT id,name,parameters_json,generator_version,created_at,updated_at FROM assets WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(user.id, limit + 1, offset).all();
    return json({ ok: true, assets: results.slice(0, limit).map(assetFields), pagination: { limit, offset, hasMore: results.length > limit, nextOffset: results.length > limit ? offset + limit : null } });
  }
  const match = path.match(/^\/api\/conseiv\/assets\/([a-f0-9-]{36})(\/export)?$/);
  if (match && ['GET', 'DELETE'].includes(method)) {
    if (method === 'DELETE') sameOrigin(request);
    const user = await authenticate(request, env), db = dbFor(env);
    const row = await db.prepare('SELECT * FROM assets WHERE id=? AND owner_id=?').bind(match[1], user.id).first();
    if (!row) fail(404, 'NOT_FOUND', 'Design not found.');
    if (method === 'DELETE') {
      if (match[2]) fail(405, 'METHOD_NOT_ALLOWED', 'Export does not support deletion.');
      await db.prepare('DELETE FROM assets WHERE id=? AND owner_id=?').bind(row.id, user.id).run();
      return json({ ok: true, deleted: true });
    }
    const generation = JSON.parse(row.geometry_json);
    if (match[2]) {
      const format = url.searchParams.get('format') || 'stl', view = url.searchParams.get('view') || 'bent';
      if (!['obj', 'stl'].includes(format) || !['bent', 'flat'].includes(view)) fail(400, 'INVALID_EXPORT', 'Choose OBJ or STL, bent or flat.');
      return new Response(format === 'obj' ? exportOBJ(generation.meshes[view]) : exportSTL(generation.meshes[view]), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="conseiv-${row.id}-${view}.${format}"`, 'Cache-Control': 'no-store' } });
    }
    return json({ ok: true, asset: assetFields(row), generation });
  }
  if (path === '/api/designer/generate-svg' && method === 'POST') {
    const body = await bodyJson(request, ['name', 'primaryColor', 'secondaryColor', 'style']);
    const design = generateBrandAsset(body);
    return json({ ok: true, ...design });
  }
  if (path.startsWith('/api/')) fail(404, 'NOT_FOUND', 'Endpoint not found.');
  return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Build the studio assets first.', { status: 503 });
}

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch (error) {
      if (error instanceof GeometryValidationError) return json({ ok: false, error: { code: 'INVALID_GEOMETRY', message: error.message, fields: error.fields } }, 422);
      if (error instanceof DesignerValidationError) return json({ ok: false, error: { code: 'INVALID_DESIGN_PARAMETERS', message: error.message, fields: error.fields } }, 422);
      if (error instanceof HttpError) return json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
      console.error('Conseiv request failed', error?.name);
      return json({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable.' } }, 503);
    }
  },
};
