/* End-to-end tests against a running API + Postgres (see .github/workflows/ci.yml). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL ?? 'http://localhost:47814/api';
const sys = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const uid = randomBytes(3).toString('hex');

class Client {
  cookies = new Map<string, string>();
  constructor(public label: string) {}
  async req(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const res = await fetch(API + path, {
      method,
      headers: {
        'content-type': 'application/json',
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i);
      const v = pair.slice(i + 1);
      if (v) this.cookies.set(k, v);
      else this.cookies.delete(k);
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  patch = (p: string, b: unknown) => this.req('PATCH', p, b);
  del = (p: string) => this.req('DELETE', p);
}

async function signup(label: string) {
  const c = new Client(label);
  const r = await c.post('/auth/signup', {
    company: `${label} AB ${uid}`,
    slug: `${label}-${uid}`,
    name: `${label[0].toUpperCase()}${label.slice(1)} Admin`,
    email: `${label}-${uid}@example.com`,
    password: 'correct horse battery',
    acceptTerms: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return c;
}

/** Creates an invite directly in the DB (emails aren't readable in CI) and accepts it. */
async function joinTenant(slug: string, label: string, role: 'ADMIN' | 'MANAGER' | 'MEMBER') {
  const tenant = await sys.tenant.findUniqueOrThrow({ where: { slug } });
  const token = randomBytes(24).toString('base64url');
  await sys.invite.create({
    data: { tenantId: tenant.id, email: `${label}-${uid}@example.com`, role, tokenHash: sha(token), expiresAt: new Date(Date.now() + 86_400_000) },
  });
  const c = new Client(label);
  const r = await c.post(`/auth/invite/${token}`, { name: `${label} Person`, password: 'correct horse battery' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const me = await c.get('/auth/me');
  return { client: c, accountId: me.json.account.id as string };
}

let alice: Client, bob: Client, carol: Client, dave: Client;
let carolId = '', daveId = '';
let projectId = '', laneId = '', taskId = '', postId = '';

test('health', async () => {
  const r = await new Client('anon').get('/health');
  assert.equal(r.status, 200);
});

test('sign up two separate organizations', async () => {
  alice = await signup('alice');
  bob = await signup('bob');
  const me = await alice.get('/auth/me');
  assert.equal(me.json.tenant.slug, `alice-${uid}`);
  assert.equal(me.json.tenant.role, 'ADMIN');
});

test('owner creates a project with a lane and a task', async () => {
  const p = await alice.post('/projects', { name: 'Test project', startDate: '2026-01-01', endDate: '2026-12-31' });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  projectId = p.json.id;
  const l = await alice.post(`/projects/${projectId}/lanes`, { name: 'Finance' });
  assert.equal(l.status, 201);
  laneId = l.json.id;
  const t = await alice.post(`/projects/${projectId}/tasks`, { title: 'Map accounts', laneId, estimateHours: 10, startDate: '2026-01-01', dueDate: '2026-02-01' });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  taskId = t.json.id;
  const t2 = await alice.post(`/projects/${projectId}/tasks`, { title: 'Reports', laneId, estimateHours: 30 });
  assert.equal(t2.status, 201);
});

test('tenant isolation: another organization cannot see or reach the project', async () => {
  const list = await bob.get('/projects');
  assert.equal(list.status, 200);
  assert.equal(list.json.length, 0);
  assert.equal((await bob.get(`/projects/${projectId}`)).status, 404);
  assert.equal((await bob.patch(`/projects/${projectId}/tasks/${taskId}`, { progress: 100 })).status, 404);
  assert.equal((await bob.post('/auth/switch', { slug: `alice-${uid}` })).status, 403);
});

test('deny by default: a member who is not on the project gets nothing', async () => {
  const j = await joinTenant(`alice-${uid}`, 'carol', 'MEMBER');
  carol = j.client;
  carolId = j.accountId;
  assert.equal((await carol.get('/projects')).json.length, 0);
  assert.equal((await carol.get(`/projects/${projectId}`)).status, 404);
});

test('contributor: can work on tasks, cannot see budget or delegate', async () => {
  const add = await alice.post(`/projects/${projectId}/members`, { accountId: carolId, role: 'CONTRIBUTOR' });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  const ov = await carol.get(`/projects/${projectId}`);
  assert.equal(ov.status, 200);
  assert.equal(ov.json.role, 'CONTRIBUTOR');
  assert.equal(ov.json.budget, null);
  assert.equal((await carol.patch(`/projects/${projectId}/tasks/${taskId}`, { progress: 50 })).status, 200);
  assert.equal((await carol.get(`/projects/${projectId}/budget`)).status, 403);
  assert.equal((await carol.post(`/projects/${projectId}/members`, { accountId: carolId, role: 'COLEAD' })).status, 403);
  assert.equal((await carol.post(`/projects/${projectId}/tasks/${taskId}/links`, { guestName: 'X', guestEmail: 'x@example.com' })).status, 403);
  assert.equal((await carol.patch(`/projects/${projectId}/tasks/${taskId}`, { budgetPostId: null })).status, 403);
});

test('task progress rolls up to the lane (weighted by hours)', async () => {
  const board = await alice.get(`/projects/${projectId}/board`);
  const lane = board.json.lanes.find((l: any) => l.id === laneId);
  // 50% on a 10h task + 0% on a 30h task = 12.5%
  assert.equal(lane.progress, 12.5);
});

test('co-lead: can manage budget, cannot delegate access', async () => {
  await sys.projectMember.updateMany({ where: { projectId, accountId: carolId }, data: { role: 'COLEAD' } });
  const post = await carol.post(`/projects/${projectId}/budget/posts`, { name: 'Consultants', amount: 100000 });
  assert.equal(post.status, 201, JSON.stringify(post.json));
  postId = post.json.id;
  assert.equal((await carol.post(`/projects/${projectId}/members`, { accountId: carolId, role: 'CONTRIBUTOR' })).status, 403);
  await sys.projectMember.updateMany({ where: { projectId, accountId: carolId }, data: { role: 'CONTRIBUTOR' } });
});

test('budget: booking an invoice updates spent', async () => {
  const c = await alice.post(`/projects/${projectId}/costs`, {
    budgetPostId: postId, taskId, supplier: 'Consult AB', reference: 'INV-1', amount: 25000, date: '2026-02-01',
  });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const b = await alice.get(`/projects/${projectId}/budget`);
  assert.equal(b.json.totals.spent, 25000);
  assert.equal(b.json.posts[0].pct, 25);
});

test('manager: sees every project read-only and can change the owner', async () => {
  const j = await joinTenant(`alice-${uid}`, 'dave', 'MANAGER');
  dave = j.client;
  daveId = j.accountId;
  const list = await dave.get('/projects');
  assert.equal(list.json.length, 1);
  const ov = await dave.get(`/projects/${projectId}`);
  assert.equal(ov.json.role, 'VIEWER');
  assert.equal((await dave.patch(`/projects/${projectId}/tasks/${taskId}`, { progress: 90 })).status, 403);
  assert.equal((await dave.post(`/projects/${projectId}/lanes`, { name: 'x' })).status, 403);
  const own = await dave.post(`/projects/${projectId}/owner`, { accountId: carolId, reason: 'test', keepAsColead: true });
  assert.equal(own.status, 200, JSON.stringify(own.json));
  const ov2 = await carol.get(`/projects/${projectId}`);
  assert.equal(ov2.json.role, 'OWNER');
  const ov3 = await alice.get(`/projects/${projectId}`);
  assert.equal(ov3.json.role, 'COLEAD');
  assert.equal((await carol.post(`/projects/${projectId}/members`, { accountId: daveId, role: 'CONTRIBUTOR' })).status, 201);
});

test('task link: external guest updates progress without logging in; revoke stops it', async () => {
  const link = await carol.post(`/projects/${projectId}/tasks/${taskId}/links`, {
    guestName: 'Anders Vik', guestEmail: 'anders@example.com', guestOrg: 'Konsult AB', days: 30,
  });
  assert.equal(link.status, 201, JSON.stringify(link.json));
  const token = String(link.json.url).split('/t/')[1];
  const guest = new Client('guest');
  const v = await guest.get(`/public/links/${token}`);
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(v.json.task.title, 'Map accounts');
  assert.equal(v.json.budget, undefined);
  const u = await guest.post(`/public/links/${token}/update`, { progress: 80, note: 'Almost done' });
  assert.equal(u.status, 200);
  const t = await carol.get(`/projects/${projectId}/tasks/${taskId}`);
  assert.equal(t.json.progress, 80);
  assert.ok(t.json.activity.some((a: any) => a.viaTaskLink && a.text === 'Almost done'));
  // The guest link opens nothing else
  assert.equal((await guest.get(`/projects/${projectId}`)).status, 401);
  assert.equal((await carol.del(`/projects/${projectId}/links/${link.json.id}`)).status, 200);
  assert.equal((await guest.get(`/public/links/${token}`)).status, 404);
  assert.equal((await guest.get(`/public/links/not-a-real-token-000000000000`)).status, 404);
});

test('reports: portfolio and project report', async () => {
  const p = await dave.get('/reports/portfolio');
  assert.equal(p.status, 200);
  assert.equal(p.json.rows.length, 1);
  const r = await carol.get(`/projects/${projectId}/report`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.curve));
});

test('admin: users, seats, audit log; members cannot use admin', async () => {
  const u = await alice.get('/admin/users');
  assert.equal(u.status, 200);
  assert.equal(u.json.members.length, 3);
  assert.equal((await carol.get('/admin/users')).status, 403);
  const a = await alice.get('/admin/audit');
  assert.ok(a.json.some((x: any) => x.action === 'project.owner_changed'));
});

test('support: ticket round trip', async () => {
  const t = await carol.post('/support/tickets', { type: 'QUESTION', subject: 'How do tollgates work?', body: 'Please explain.' });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  assert.match(t.json.ref, /^LR-\d{4,}$/);
  assert.equal((await bob.get(`/support/tickets/${t.json.id}`)).status, 404);
});

test('demo: public demo can be entered as a manager and has sample projects', async () => {
  const info = await new Client('x').get('/demo/public');
  assert.equal(info.status, 200, JSON.stringify(info.json));
  const v = new Client('visitor');
  const e = await v.post('/demo/public/enter', { as: 'manager' });
  assert.equal(e.status, 200, JSON.stringify(e.json));
  const list = await v.get('/projects');
  assert.equal(list.json.length, 8);
  assert.ok(list.json.some((p: any) => p.health === 'BEHIND'));
  // Demo users can't invite anyone
  const g = await v.post('/demo/public/enter', { as: 'guest' });
  assert.match(g.json.next, /^\/t\//);
});

test('database role cannot read other tenants even without the API', async () => {
  const app = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
  const n = await app.project.count();
  assert.equal(n, 0, 'without a tenant set, the app role must see no projects');
  await app.$disconnect();
});

test.after(async () => {
  await sys.$disconnect();
});
