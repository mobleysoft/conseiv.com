import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';

let mf, db;
const origin = 'https://conseiv.test';
const users = { alice: {id:'user-alice',name:'Alice',email:'alice@example.test'}, bob: {id:'user-bob',name:'Bob',email:'bob@example.test'}, charlie: {id:'user-charlie',name:'Charlie',email:'charlie@example.test'} };
const tokens = { alice: 'test-alice-token-00001', bob: 'test-bob-token-00002', charlie: 'test-charlie-token-00003' };
const calls = [];
async function auth(request) {
  const path = new URL(request.url).pathname;
  calls.push({path,method:request.method});
  if (path === '/api/v1/verify') {
    const who = Object.keys(tokens).find(k => request.headers.get('Authorization') === `Bearer ${tokens[k]}`);
    return MFResponse.json(who ? users[who] : {error:'Invalid token'}, {status:who ? 200 : 401});
  }
  if (['/api/v1/login', '/api/v1/register'].includes(path)) {
    const body = await request.json();
    assert.equal(body.venture_id, 'conseiv.com'); assert.equal(body.client_id, 'conseiv');
    const who = Object.keys(users).find(k => users[k].email === body.email);
    return MFResponse.json(who ? {token:tokens[who],user:users[who]} : {error:'Invalid'}, {status:who ? 200 : 401});
  }
  return new MFResponse('Missing', {status:404});
}
const request = (path, { method='GET', body, token, cookie, headers={} }={}) => mf.dispatchFetch(origin + path, {
  method, headers: {Origin:origin,...(body !== undefined ? {'Content-Type':'application/json'} : {}),...(token ? {Authorization:`Bearer ${token}`} : {}),...(cookie ? {Cookie:cookie} : {}),...headers},
  ...(body !== undefined ? {body:typeof body === 'string' ? body : JSON.stringify(body)} : {}),
});
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ modules:true, scriptPath:'.test-build/index.js', compatibilityDate:'2026-08-27', d1Databases:['DB'], bindings:{AUTHFOR_ORIGIN:'https://authfor.com'}, serviceBindings:{AUTHFOR:auth} }));
  db = await mf.getD1Database('DB');
  for (const file of (await readdir('migrations')).sort()) {
    const sql = await readFile(`migrations/${file}`, 'utf8');
    for (const statement of sql.split(';').filter(s=>s.trim())) await db.prepare(statement).run();
  }
});
after(async () => { await mf?.dispose(); });

test('health checks real local D1 and preview generates actual geometry without auth', async () => {
  assert.equal((await request('/api/health')).status, 200);
  const r = await request('/api/conseiv/cad-mesh-generation', {method:'POST', body:{parameters:{}}});
  assert.equal(r.status, 200); assert.equal(r.headers.get('Cache-Control'), 'no-store');
  const data = await r.json(); assert.equal(data.metadata.holeCount, 4); assert.ok(data.meshes.bent.positions.length > 100);
});
test('body limits, shape validation, and no misleading API SPA fallback', async () => {
  for (const [body, status] of [[{},200],[{parameters:{thickness:-1}},422],[{owner_id:'forged'},400],['{bad',400],[{save:'yes'},400]]) {
    assert.equal((await request('/api/conseiv/cad-mesh-generation',{method:'POST',body})).status, status);
  }
  assert.equal((await request('/api/conseiv/cad-mesh-generation', {method:'POST',body:' '.repeat(17000)})).status, 413);
  assert.equal((await request('/api/conseiv/cad-mesh-generation', {method:'POST',body:'{}',headers:{'Content-Type':'text/plain'}})).status, 415);
  assert.equal((await request('/api/missing')).status, 404);
});
test('save and reads fail closed without authentication or with cross-origin mutation', async () => {
  assert.equal((await request('/api/conseiv/assets', {method:'POST',body:{parameters:{}}})).status, 401);
  assert.equal((await request('/api/conseiv/assets')).status, 401);
  assert.equal((await request('/api/conseiv/assets', {method:'POST',token:tokens.alice,body:{parameters:{}},headers:{Origin:'https://attacker.test'}})).status, 403);
});
test('AuthFor verified ownership governs list, read, export and delete, with real D1 persistence', async () => {
  const r = await request('/api/conseiv/assets',{method:'POST',token:tokens.alice,body:{name:'Real bracket',parameters:{legAWidth:100}}});
  assert.equal(r.status,201,await r.clone().text()); const saved = await r.json(), path = `/api/conseiv/assets/${saved.asset.id}`;
  const own = await (await request(path,{token:tokens.alice})).json();
  assert.deepEqual(own.generation, saved.generation);
  assert.equal((await request(path,{token:tokens.bob})).status,404);
  assert.equal((await request(path+'/export',{token:tokens.bob})).status,404);
  assert.equal((await request(path,{method:'DELETE',token:tokens.bob})).status,404);
  assert.equal((await (await request('/api/conseiv/assets',{token:tokens.bob})).json()).assets.length,0);
  const exportResponse = await request(path+'/export?format=obj&view=flat',{token:tokens.alice});
  assert.match(exportResponse.headers.get('Content-Disposition'),/attachment/);
  assert.match(await exportResponse.text(),/^# Conseiv/);
  assert.equal((await request(path+'/export?format=exe',{token:tokens.alice})).status,400);
  assert.equal((await request('/api/conseiv/assets?limit=51',{token:tokens.alice})).status,400);
  assert.equal((await request(path,{method:'DELETE',token:tokens.alice})).status,200);
  assert.equal((await request(path,{token:tokens.alice})).status,404);
});
test('cookie session hashes, per-request provider verification, and logout revocation', async () => {
  const response = await request('/api/auth/login',{method:'POST',body:{email:users.alice.email,password:'not-a-real-password'}});
  assert.equal(response.status,200,await response.clone().text());
  const cookieHeader = response.headers.get('Set-Cookie'), cookie = cookieHeader.split(';')[0];
  assert.match(cookieHeader,/HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await response.json()).token, undefined);
  const row = await db.prepare('SELECT * FROM sessions WHERE user_id=?').bind(users.alice.id).first();
  assert.match(row.token_hash,/^[0-9a-f]{64}$/); assert.equal(row.authfor_token,undefined);
  const start = calls.filter(c=>c.path==='/api/v1/verify').length;
  assert.equal((await request('/api/auth/me',{cookie})).status,200);
  assert.equal(calls.filter(c=>c.path==='/api/v1/verify').length,start+1);
  assert.equal((await request('/api/auth/me',{cookie,headers:{Authorization:'Basic junk'}})).status,401);
  assert.equal((await request('/api/auth/logout',{method:'POST',cookie})).status,200);
  assert.equal((await request('/api/auth/me',{cookie})).status,401);
});
test('login is rate limited per IP and per email after repeated attempts', async () => {
  const ip = '203.0.113.9', email = users.charlie.email;
  for (let i = 0; i < 10; i++) {
    const r = await request('/api/auth/login', { method: 'POST', body: { email, password: 'not-a-real-password' }, headers: { 'CF-Connecting-IP': ip } });
    assert.equal(r.status, 200, `attempt ${i} should succeed, got ${r.status}`);
  }
  const blocked = await request('/api/auth/login', { method: 'POST', body: { email, password: 'not-a-real-password' }, headers: { 'CF-Connecting-IP': ip } });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error.code, 'RATE_LIMITED');
  const otherIpSameEmail = await request('/api/auth/login', { method: 'POST', body: { email, password: 'not-a-real-password' }, headers: { 'CF-Connecting-IP': '198.51.100.5' } });
  assert.equal(otherIpSameEmail.status, 429, 'email bucket should still block even from a different IP');
  const sameIpOtherEmail = await request('/api/auth/login', { method: 'POST', body: { email: users.bob.email, password: 'not-a-real-password' }, headers: { 'CF-Connecting-IP': ip } });
  assert.equal(sameIpOtherEmail.status, 429, 'IP bucket should still block a different email from the same IP');
});
test('registration uses AuthFor, not an independent password database', async () => {
  const response = await request('/api/auth/register',{method:'POST',body:{...users.bob,id:undefined,password:'not-a-real-password'}});
  assert.equal(response.status,200);
  assert.ok(calls.some(c=>c.path==='/api/v1/register' && c.method==='POST'));
  const columns = await db.prepare('PRAGMA table_info(users)').all();
  assert.ok(!columns.results.some(c=>/password|token/.test(c.name)));
});
