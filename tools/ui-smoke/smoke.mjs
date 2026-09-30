// Browser smoke test: clicks through the main flows for every role and saves screenshots.
// Fails on uncaught page errors, console errors and any 5xx response.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:47813';
const OUT = process.env.SHOTS_DIR ?? '../../ci-logs/shots';
const OP_EMAIL = process.env.OPERATOR_EMAIL;
const OP_PASS = process.env.OPERATOR_PASSWORD;
mkdirSync(OUT, { recursive: true });

const problems = [];
const passed = [];
let n = 0;

const browser = await chromium.launch();

function watch(page, label) {
  page.on('pageerror', (e) => problems.push(`[${label}] page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of (401|403|404|409)/.test(m.text())) {
      problems.push(`[${label}] console error: ${m.text()}`);
    }
  });
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`[${label}] HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  });
}

async function ctx(label, viewport = { width: 1440, height: 900 }) {
  const c = await browser.newContext({ viewport });
  const page = await c.newPage();
  page.setDefaultTimeout(15000);
  watch(page, label);
  return { c, page };
}

async function shot(page, name) {
  n += 1;
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png`, fullPage: false });
}

async function step(name, fn) {
  try {
    await fn();
    passed.push(name);
    console.log(`ok   ${name}`);
  } catch (e) {
    problems.push(`[${name}] FAILED: ${e.message.split('\n')[0]}`);
    console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
  }
}

const nav = (page, name) => page.locator('nav.side').getByRole('link', { name, exact: true }).click();

// ---------------- Manager in the demo ----------------
await step('demo: manager sees portfolio, can open change-owner drawer, project is read-only', async () => {
  const { c, page } = await ctx('manager');
  await page.goto(`${BASE}/demo`);
  await shot(page, 'demo-entry');
  await page.getByRole('button', { name: /Portfolio manager/ }).click();
  await page.getByRole('heading', { name: 'Portfolio' }).waitFor();
  await page.getByText('Needs your attention').waitFor();
  await shot(page, 'manager-portfolio');
  await page.getByRole('button', { name: 'Change owner' }).first().click();
  await page.getByRole('dialog', { name: /Harbor|Warehouse|Customer|Fleet|ISO|Office|Carrier|Sustainability/ }).waitFor();
  await shot(page, 'manager-change-owner');
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Harbor ERP rollout' }).first().click();
  await page.getByText(/You’re viewing as a portfolio manager/).waitFor();
  await shot(page, 'manager-project-readonly');
  if (await page.getByRole('link', { name: 'Add task' }).count()) throw new Error('Manager sees "Add task" on a project they are not on');
  await nav(page, 'Plan & tollgates');
  await page.locator('.gantt').waitFor();
  await shot(page, 'manager-plan');
  await nav(page, 'Reports');
  await page.getByRole('heading', { name: 'Reports' }).waitFor();
  await page.getByText('Project status').waitFor();
  await shot(page, 'manager-reports');
  await c.close();
});

// ---------------- Owner in the demo ----------------
await step('demo: owner works the project (lanes, task, budget, setup, team)', async () => {
  const { c, page } = await ctx('owner');
  await page.goto(`${BASE}/demo`);
  await page.getByRole('button', { name: /Project owner/ }).click();
  await page.getByRole('heading', { name: 'Harbor ERP rollout' }).waitFor();
  await shot(page, 'owner-overview');

  await nav(page, 'Swim lanes');
  await page.getByRole('heading', { name: 'Swim lanes' }).waitFor();
  const lane = page.locator('section.lane').filter({ hasText: 'Data migration' });
  const before = await lane.locator('.display').first().innerText();
  await lane.getByRole('button', { name: /Raise progress on Trial migration/ }).click();
  await page.waitForFunction(([sel, b]) => document.querySelector(sel)?.textContent !== b, ['section.lane:nth-of-type(3) .display', before]).catch(() => {});
  await page.waitForTimeout(600);
  const after = await lane.locator('.display').first().innerText();
  if (after === before) throw new Error(`Lane progress did not change after +25% (${before} → ${after})`);
  await shot(page, 'owner-lanes-after-bump');

  await page.getByRole('link', { name: 'Customer master cleanse' }).click();
  await page.getByText('Share with someone outside').waitFor();
  await shot(page, 'owner-task');

  await nav(page, 'Budget & costs');
  await page.getByText('Booked invoices & costs').waitFor();
  await shot(page, 'owner-budget');
  await page.getByRole('button', { name: 'Book an invoice' }).click();
  const dlg = page.getByRole('dialog', { name: 'Book an invoice' });
  await dlg.getByLabel('Supplier').fill('Smoke Test AB');
  await dlg.getByLabel('Amount excl. VAT').fill('12500');
  await dlg.getByText(/After this/).waitFor();
  await shot(page, 'owner-book-invoice');
  await dlg.getByRole('button', { name: /^Book/ }).click();
  await page.getByText('Smoke Test AB').waitFor();

  await nav(page, 'Directives & KPIs');
  for (const s of ['Directives', 'KPIs', 'Tollgates', 'Budget', 'Team']) {
    await page.locator('.steps').getByRole('button', { name: new RegExp(s) }).click();
    await page.waitForTimeout(300);
    await shot(page, `owner-setup-${s.toLowerCase()}`);
  }

  await nav(page, 'Team & access');
  await page.getByText('What each role can do').waitFor();
  await shot(page, 'owner-team');

  await nav(page, 'Status report');
  await page.getByText('Planned vs actual progress').waitFor();
  await shot(page, 'owner-report');
  await c.close();
});

await step('demo: owner (Elin) is admin — admin, billing and support pages', async () => {
  const { c, page } = await ctx('admin');
  await page.goto(`${BASE}/demo`);
  await page.getByRole('button', { name: /Project owner/ }).click();
  await page.getByRole('heading', { name: 'Harbor ERP rollout' }).waitFor();
  await nav(page, 'Admin');
  await page.getByRole('heading', { name: 'Users' }).waitFor();
  await shot(page, 'admin-users');
  await page.getByRole('button', { name: 'Security & policies' }).click();
  await page.getByText('Task links: longest lifetime').waitFor();
  await shot(page, 'admin-security');
  await page.getByRole('button', { name: 'Audit log' }).click();
  await page.waitForTimeout(500);
  await nav(page, 'Billing');
  await page.getByRole('heading', { name: 'Billing' }).waitFor();
  await nav(page, 'Help & support');
  await page.getByText('Contact Lockred').waitFor();
  await shot(page, 'support');
  await c.close();
});

// ---------------- Contributor ----------------
await step('demo: contributor cannot see budget', async () => {
  const { c, page } = await ctx('contributor');
  await page.goto(`${BASE}/demo`);
  await page.getByRole('button', { name: /Contributor/ }).click();
  await page.getByRole('link', { name: 'Harbor ERP rollout' }).first().click();
  await page.getByRole('heading', { name: 'Harbor ERP rollout' }).waitFor();
  if (await page.locator('nav.side').getByRole('link', { name: 'Budget & costs' }).count()) throw new Error('Contributor sees Budget & costs in the menu');
  await page.getByText('Visible to the owner and co-leads.').waitFor();
  await shot(page, 'contributor-overview');
  await page.goto(page.url() + '/budget');
  await page.getByText('Budget is visible to the project owner and co-leads.').waitFor();
  await c.close();
});

// ---------------- Guest task link (phone) ----------------
await step('guest: task link on a phone, update progress without login', async () => {
  const { c, page } = await ctx('guest', { width: 390, height: 844 });
  await page.goto(`${BASE}/demo`);
  await page.getByRole('button', { name: /Consultant with a task link/ }).click();
  await page.getByText('How far along are you?').waitFor();
  await shot(page, 'guest-task-phone');
  await page.getByRole('button', { name: '75%' }).click();
  await page.getByLabel(/What changed/).fill('Smoke test update');
  await page.getByRole('button', { name: 'Send update' }).click();
  await page.getByText('Thanks, update sent').waitFor();
  await shot(page, 'guest-sent');
  await c.close();
});

// ---------------- Mobile portfolio ----------------
await step('mobile: portfolio with menu', async () => {
  const { c, page } = await ctx('mobile', { width: 390, height: 844 });
  await page.goto(`${BASE}/demo`);
  await page.getByRole('button', { name: /Portfolio manager/ }).click();
  await page.getByText('Needs your attention').waitFor();
  await shot(page, 'mobile-portfolio');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.waitForTimeout(300);
  await shot(page, 'mobile-menu');
  await c.close();
});

// ---------------- New customer sign-up ----------------
const slug = `smoke-${Date.now().toString(36)}`;
await step('sign-up: create organization, first project, setup wizard', async () => {
  const { c, page } = await ctx('signup');
  await page.goto(`${BASE}/signup`);
  await page.getByLabel('Organization name').fill('Smoke Logistics AB');
  await page.getByLabel('Your web address').fill(slug);
  await page.getByLabel('Your name').fill('Sam Smoke');
  await page.getByLabel('Work email').fill(`${slug}@example.com`);
  await page.getByLabel(/^Password/).fill('correct horse battery');
  await page.getByRole('checkbox').check();
  await shot(page, 'signup');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await page.getByText('No projects yet').waitFor();
  await shot(page, 'new-tenant-empty');
  await page.getByRole('button', { name: 'Create your first project' }).click();
  await page.getByLabel('Project name').fill('New warehouse system');
  await page.getByRole('button', { name: 'Create and set up' }).click();
  await page.getByText('What is this project for?').waitFor();
  await page.getByPlaceholder('e.g. Go live before 1 December').fill('Stay within budget');
  await page.getByRole('button', { name: 'Add directive' }).click();
  await page.getByText('D1').waitFor();
  await page.getByRole('button', { name: /Next: KPIs/ }).click();
  await page.getByRole('button', { name: 'On-time delivery' }).click();
  await page.getByRole('button', { name: /Next: Tollgates/ }).click();
  await page.getByRole('button', { name: /5 gates/ }).click();
  await page.getByText('TG5').waitFor();
  await shot(page, 'new-setup-tollgates');
  await page.getByRole('button', { name: /Next: Budget/ }).click();
  await page.getByLabel('New budget post name').fill('Consultants');
  await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('500000');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Next: Team/ }).click();
  await page.getByRole('button', { name: 'Open the project' }).click();
  await page.getByRole('heading', { name: 'New warehouse system' }).waitFor();
  await nav(page, 'Swim lanes');
  await page.getByRole('button', { name: 'Add the first lane' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Build');
  await page.getByRole('dialog').getByRole('button', { name: 'Add lane', exact: true }).click();
  await page.getByRole('button', { name: '+ Task in this lane' }).click();
  await page.getByLabel('What needs to be done?').fill('Pick a vendor');
  await page.getByLabel('Estimate (hours)').fill('20');
  await page.getByRole('dialog').getByRole('button', { name: 'Add task' }).click();
  await page.getByRole('link', { name: 'Pick a vendor' }).waitFor();
  await shot(page, 'new-lanes');
  await c.close();
});

// ---------------- Operator console ----------------
await step('operator: console, add partner, partner portal', async () => {
  if (!OP_EMAIL || !OP_PASS) throw new Error('OPERATOR_EMAIL / OPERATOR_PASSWORD not set');
  const { c, page } = await ctx('operator');
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Work email').fill(OP_EMAIL);
  await page.getByLabel('Password').fill(OP_PASS);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/ops|\/select/);
  await page.goto(`${BASE}/ops`);
  await page.getByRole('heading', { name: 'Tenants' }).waitFor();
  await page.getByText('Smoke Logistics AB').waitFor();
  await shot(page, 'ops-tenants');
  await page.getByText('Smoke Logistics AB').click();
  await page.getByText('Danger zone').waitFor();
  await shot(page, 'ops-tenant');
  await page.getByRole('link', { name: 'Affiliates' }).click();
  await page.getByRole('button', { name: 'Add partner' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill('Smoke Partner');
  await d.getByLabel('Email').fill(OP_EMAIL);
  await d.getByLabel(/Referral code/).fill('smoke-partner');
  await d.getByRole('button', { name: 'Add partner' }).click();
  await page.getByText('smoke-partner').waitFor({ timeout: 45000 });
  await shot(page, 'ops-affiliates');
  await page.getByRole('link', { name: 'Demo portals' }).click();
  await page.getByText('Smoke Partner’s demo').waitFor();
  await page.getByRole('link', { name: 'Support' }).click();
  await page.getByRole('heading', { name: 'Support queue' }).waitFor();
  await page.getByRole('link', { name: 'System' }).click();
  await page.getByText('Totals').waitFor();
  await shot(page, 'ops-system');
  await page.goto(`${BASE}/partners`);
  await page.getByText('Your referral link').waitFor();
  await shot(page, 'partner-portal');
  await page.goto(`${BASE}/demo/smoke-partner`);
  await page.getByText('Shared by').waitFor();
  await shot(page, 'partner-demo-entry');
  await c.close();
});

await browser.close();
const report = [`passed: ${passed.length}`, ...passed.map((p) => `  ok ${p}`), `problems: ${problems.length}`, ...problems.map((p) => `  ${p}`)].join('\n');
writeFileSync(`${OUT}/../ui-report.txt`, report);
console.log('\n' + report);
process.exit(problems.length ? 1 : 0);
