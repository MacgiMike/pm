import { Prisma } from '@prisma/client';
import { Tx } from '../core/prisma.service';
import { sha256 } from '../core/tokens';
import { addDays, todayUtc } from '../core/util';

export interface DemoPeople {
  [key: string]: { id: string; name: string };
}

export const DEMO_PEOPLE: { key: string; name: string; role: 'ADMIN' | 'MANAGER' | 'MEMBER' }[] = [
  { key: 'elin', name: 'Elin Lund', role: 'ADMIN' },
  { key: 'per', name: 'Per Åström', role: 'MANAGER' },
  { key: 'omar', name: 'Omar Haddad', role: 'MEMBER' },
  { key: 'jonas', name: 'Jonas Berg', role: 'MEMBER' },
  { key: 'karin', name: 'Karin Holm', role: 'MEMBER' },
  { key: 'sara', name: 'Sara Nyberg', role: 'MEMBER' },
  { key: 'maria', name: 'Maria Ek', role: 'MEMBER' },
  { key: 'ali', name: 'Ali Rahimi', role: 'MEMBER' },
  { key: 'lina', name: 'Lina Sjöberg', role: 'MEMBER' },
];

/** Fills a demo tenant with a realistic, fictional logistics company. Dates are relative to today. */
export async function seedDemo(tx: Tx, tenantId: string, people: DemoPeople, guestToken: string) {
  const today = todayUtc();
  const d = (n: number) => addDays(today, n);
  const T = tenantId;

  const project = async (p: { name: string; purpose: string; sponsor?: string; start: number; end: number; budget: number; owner: string; status?: 'ACTIVE' | 'SETUP' }) =>
    tx.project.create({
      data: {
        tenantId: T,
        name: p.name,
        purpose: p.purpose,
        sponsor: p.sponsor ?? '',
        startDate: d(p.start),
        endDate: d(p.end),
        status: p.status ?? 'ACTIVE',
        approvedBudget: p.budget,
        setupStep: 6,
      },
    });
  const member = (projectId: string, key: string, role: 'OWNER' | 'COLEAD' | 'CONTRIBUTOR') =>
    tx.projectMember.create({ data: { tenantId: T, projectId, accountId: people[key].id, role, addedById: people.elin.id } });

  // ---------------- Harbor ERP rollout (the detailed one) ----------------
  const h = await project({
    name: 'Harbor ERP rollout',
    purpose: 'Replace the old ERP before vendor support ends, and cut the time it takes to handle an order.',
    sponsor: 'Per Åström (CFO)',
    start: -140,
    end: 80,
    budget: 2_100_000,
    owner: 'elin',
  });
  await tx.project.update({
    where: { id: h.id },
    data: { inScope: ['Finance', 'Warehouse', 'Order-to-cash', 'Data migration', 'Training'], outScope: ['HR & payroll', 'Customer portal (own project)'] },
  });
  await member(h.id, 'elin', 'OWNER');
  await member(h.id, 'jonas', 'COLEAD');
  await member(h.id, 'omar', 'CONTRIBUTOR');
  await member(h.id, 'karin', 'CONTRIBUTOR');
  await member(h.id, 'lina', 'CONTRIBUTOR');

  const directives = [
    ['Go live before 1 December — never during year-end close.', 'Steering group'],
    ['Standard processes first. Customizations need steering approval.', 'Steering group'],
    ['Migrate at most five years of transaction history.', 'CFO'],
  ];
  for (let i = 0; i < directives.length; i++) {
    await tx.directive.create({ data: { tenantId: T, projectId: h.id, text: directives[i][0], source: directives[i][1], sort: i } });
  }

  const kpis: [string, string, number | null, number, 'INCREASE' | 'DECREASE', string, string, boolean, number[]][] = [
    ['Order handling time', 'h', 6.5, 4, 'DECREASE', 'Weekly', 'Omar Haddad', false, [6.5, 6.3, 6.1, 5.8]],
    ['Inventory accuracy', '%', 96.1, 98, 'INCREASE', 'Monthly', 'Omar Haddad', false, [96.1, 97.2, 98.3]],
    ['Month-end close', 'days', 7, 5, 'DECREASE', 'Monthly', 'Elin Lund', false, [7, 7]],
    ['Active users 4 weeks after go-live', '%', null, 90, 'INCREASE', 'Once', 'Karin Holm', true, []],
  ];
  for (let i = 0; i < kpis.length; i++) {
    const [name, unit, baseline, target, direction, frequency, ownerName, afterGoLive, values] = kpis[i];
    const k = await tx.kpi.create({
      data: { tenantId: T, projectId: h.id, name, unit, baseline, target, direction, frequency, ownerName, afterGoLive, sort: i },
    });
    for (let j = 0; j < values.length; j++) {
      await tx.kpiValue.create({
        data: { tenantId: T, kpiId: k.id, value: values[j], measuredAt: d(-30 * (values.length - 1 - j) - 2), createdById: people.elin.id },
      });
    }
  }

  const gates: [string, string, number, boolean, [string, boolean][]][] = [
    ['TG1', 'Project start', -140, true, [['Directives approved', true], ['Budget approved', true]]],
    ['TG2', 'Design approved', -61, true, [['Process designs signed off', true], ['Data scope agreed', true]]],
    ['TG3', 'Build approval', 15, false, [
      ['Configuration complete in test', true],
      ['Integrations tested end to end', true],
      ['Test plan approved', true],
      ['Trial migration passed', false],
      ['Cut-over plan agreed', false],
    ]],
    ['TG4', 'Go-live', 56, false, [['Acceptance test passed', false], ['Users trained', false]]],
    ['TG5', 'Closure', 80, false, [['KPIs baselined', false], ['Lessons learned recorded', false]]],
  ];
  const gateIds: Record<string, string> = {};
  for (let i = 0; i < gates.length; i++) {
    const [code, name, off, passed, criteria] = gates[i];
    const g = await tx.tollgate.create({
      data: { tenantId: T, projectId: h.id, code, name, date: d(off), sort: i, passedAt: passed ? d(off) : null, passedById: passed ? people.elin.id : null },
    });
    gateIds[code] = g.id;
    for (let j = 0; j < criteria.length; j++) {
      await tx.tollgateCriterion.create({ data: { tenantId: T, tollgateId: g.id, text: criteria[j][0], met: criteria[j][1], sort: j } });
    }
  }

  const lanes: Record<string, string> = {};
  const laneDefs: [string, string, string, string][] = [
    ['fin', 'Finance', '#2F5BD3', 'elin'],
    ['wh', 'Warehouse', '#0F6B5C', 'omar'],
    ['dm', 'Data migration', '#A3201C', 'jonas'],
    ['tr', 'Training & change', '#8A4306', 'karin'],
  ];
  for (let i = 0; i < laneDefs.length; i++) {
    const [k, name, color, lead] = laneDefs[i];
    const l = await tx.lane.create({ data: { tenantId: T, projectId: h.id, name, color, leadAccountId: people[lead].id, sort: i } });
    lanes[k] = l.id;
  }

  const posts: Record<string, string> = {};
  const postDefs: [string, string, number][] = [
    ['ext', 'External consultants', 900_000],
    ['lic', 'Software licenses', 450_000],
    ['hw', 'Hardware (scanners)', 300_000],
    ['trn', 'Training', 200_000],
    ['int', 'Internal time', 150_000],
    ['cont', 'Contingency', 100_000],
  ];
  for (let i = 0; i < postDefs.length; i++) {
    const [k, name, amount] = postDefs[i];
    const p = await tx.budgetPost.create({ data: { tenantId: T, projectId: h.id, name, amount, sort: i } });
    posts[k] = p.id;
  }

  const taskDefs: [string, string, string | null, number, number, number, number, string, string][] = [
    // key, title, assignee, start, due, hours, progress, lane, gate
    ['coa', 'Chart of accounts mapping', 'elin', -28, -3, 40, 100, 'fin', 'TG3'],
    ['apar', 'AP/AR configuration', 'jonas', -14, 21, 80, 60, 'fin', 'TG3'],
    ['frep', 'Financial reports build', 'elin', 6, 42, 60, 0, 'fin', 'TG4'],
    ['bin', 'Bin location import', 'omar', -21, 4, 50, 75, 'wh', 'TG3'],
    ['scan', 'Handheld scanner setup', 'omar', -7, 25, 70, 25, 'wh', 'TG4'],
    ['cust', 'Customer master cleanse', null, -28, 1, 120, 55, 'dm', 'TG3'],
    ['trial', 'Trial migration #1', 'jonas', 2, 18, 60, 0, 'dm', 'TG3'],
    ['sup', 'Super-user training plan', 'karin', -8, 13, 30, 25, 'tr', 'TG4'],
    ['comm', 'Go-live communication', 'karin', 34, 52, 20, 0, 'tr', 'TG4'],
  ];
  const tasks: Record<string, string> = {};
  for (let i = 0; i < taskDefs.length; i++) {
    const [k, title, who, s, e, hours, progress, lane, gate] = taskDefs[i];
    const t = await tx.task.create({
      data: {
        tenantId: T,
        projectId: h.id,
        laneId: lanes[lane],
        tollgateId: gateIds[gate],
        budgetPostId: lane === 'dm' || lane === 'fin' ? posts.ext : lane === 'wh' && k === 'scan' ? posts.hw : lane === 'tr' ? posts.trn : null,
        title,
        description:
          k === 'cust'
            ? 'Remove duplicates, fix addresses and VAT numbers, and mark inactive customers so only clean records move to the new ERP.'
            : '',
        assigneeAccountId: who ? people[who].id : null,
        startDate: d(s),
        dueDate: d(e),
        estimateHours: hours,
        progress,
        sort: i,
        createdById: people.elin.id,
      },
    });
    tasks[k] = t.id;
  }
  for (const [text, done] of [
    ['Merge duplicate customers', true],
    ['Validate VAT numbers', true],
    ['Fix Norwegian addresses', false],
    ['Sign-off from Finance', false],
  ] as [string, boolean][]) {
    await tx.checklistItem.create({ data: { tenantId: T, taskId: tasks.cust, text, done } });
  }

  // Post links: where the money goes
  const link = (postKey: string, laneKey?: string, taskKey?: string) =>
    tx.budgetPostLink.create({
      data: { tenantId: T, budgetPostId: posts[postKey], laneId: laneKey ? lanes[laneKey] : null, taskId: taskKey ? tasks[taskKey] : null },
    });
  await link('ext', 'dm');
  await link('ext', 'fin');
  await link('hw', undefined, 'scan');
  await link('trn', 'tr');

  const costs: [string, string, string, number, number, string | null, string | null][] = [
    // supplier, reference, post, amount, dayOffset, lane, task
    ['Datakonsult AB', 'INV-2291', 'ext', 186_000, -5, 'dm', 'cust'],
    ['Nordic Scan Supply', '88-4410', 'hw', 120_000, -10, 'wh', 'scan'],
    ['Datakonsult AB', 'INV-2244', 'ext', 214_000, -29, 'fin', 'apar'],
    ['ERP vendor', 'LIC-Q3', 'lic', 390_000, -45, null, null],
    ['Internal time report', 'Month 4', 'int', 50_000, -30, null, null],
    ['Internal time report', 'Month 3', 'int', 50_000, -60, null, null],
    ['Datakonsult AB', 'INV-2150', 'ext', 210_000, -90, 'fin', null],
    ['Trainer booking', 'TB-118', 'trn', 20_000, -20, 'tr', 'sup'],
  ];
  for (const [supplier, reference, post, amount, off, lane, task] of costs) {
    await tx.cost.create({
      data: {
        tenantId: T,
        projectId: h.id,
        budgetPostId: posts[post],
        laneId: lane ? lanes[lane] : null,
        taskId: task ? tasks[task] : null,
        supplier,
        reference,
        amount,
        date: d(off),
        createdById: people.elin.id,
      },
    });
  }

  // External consultant with a task link
  const guest = await tx.taskLink.create({
    data: {
      tenantId: T,
      projectId: h.id,
      taskId: tasks.cust,
      tokenHash: sha256(guestToken),
      guestName: 'Anders Vik',
      guestEmail: 'anders@example.com',
      guestOrg: 'Datakonsult AB',
      canComment: true,
      canFiles: true,
      untilDone: true,
      expiresAt: d(60),
      lastUsedAt: new Date(Date.now() - 2 * 3_600_000),
      createdById: people.elin.id,
    },
  });

  const act = (kind: string, text: string, actorKey: string | null, taskKey: string | null, hoursAgo: number, extra: Partial<Prisma.ActivityUncheckedCreateInput> = {}) =>
    tx.activity.create({
      data: {
        tenantId: T,
        projectId: h.id,
        taskId: taskKey ? tasks[taskKey] : null,
        actorAccountId: actorKey ? people[actorKey].id : null,
        actorName: actorKey ? people[actorKey].name : 'Anders Vik',
        kind,
        text,
        createdAt: new Date(Date.now() - hoursAgo * 3_600_000),
        ...extra,
      },
    });
  await act('task.progress', 'moved progress 40% → 55%', null, 'cust', 2, { viaTaskLinkId: guest.id, data: { from: 40, to: 55 } });
  await act('comment', 'Duplicates done. Addresses for the Norway customers left, about 300 records.', null, 'cust', 2, { viaTaskLinkId: guest.id });
  await act('cost.booked', 'booked INV-2291 · 186 000 SEK from Datakonsult AB on External consultants', 'elin', 'cust', 120, { budgetOnly: true });
  await act('task.progress', 'moved progress 50% → 75%', 'omar', 'bin', 26);
  await act('task.progress', 'moved progress 90% → 100%', 'elin', 'coa', 80);
  await act('link.created', 'shared the task with Anders Vik', 'elin', 'cust', 700);

  // Nightly snapshots so the report has an actual curve
  const start = d(-140);
  for (let day = -140; day <= -1; day += 7) {
    const f = (day + 140) / 140;
    await tx.projectSnapshot.create({
      data: { tenantId: T, projectId: h.id, date: d(day), progress: Math.round(41 * Math.pow(f, 1.15) * 10) / 10, planned: 0, spent: Math.round(1_240_000 * f) },
    });
  }
  void start;

  // ---------------- The rest of the portfolio ----------------
  const others: [string, string, string, number, number, number, number, number, [string, string, number]][] = [
    ['Warehouse automation Gävle', 'Automate picking in the Gävle warehouse to handle peak season without extra staff.', 'omar', -170, 40, 71, 3_600_000, 3_900_000, ['TG4', 'Go-live', 34]],
    ['Customer portal v2', 'Let customers book and track shipments themselves.', 'sara', -35, 65, 38, 1_100_000, 410_000, ['TG2', 'Design sign-off', 10]],
    ['Fleet telematics pilot', 'Test live tracking and fuel data on 40 trucks.', 'jonas', -70, 50, 55, 900_000, 620_000, ['TG3', 'Pilot review', 22]],
    ['ISO 27001 certification', 'Certify information security before the big tender next year.', 'maria', -40, 60, 22, 750_000, 180_000, ['TG2', 'Gap analysis done', 1]],
    ['Office move Malmö', 'Move the Malmö office to the new harbor building.', 'karin', -190, 16, 92, 1_500_000, 1_460_000, ['TG5', 'Closure', 16]],
    ['Carrier API integration', 'Book carriers directly from the order system.', 'ali', -50, 50, 48, 800_000, 520_000, ['TG3', 'Test sign-off', 29]],
    ['Sustainability reporting', 'Report CO₂ per shipment to customers.', 'elin', -10, 90, 8, 600_000, 40_000, ['TG1', 'Kick-off', 7]],
  ];
  for (const [name, purpose, owner, s, e, prog, budget, spent, gate] of others) {
    const p = await project({ name, purpose, start: s, end: e, budget, owner });
    await member(p.id, owner, 'OWNER');
    if (owner !== 'lina') await member(p.id, 'lina', 'CONTRIBUTOR');
    const l1 = await tx.lane.create({ data: { tenantId: T, projectId: p.id, name: 'Delivery', color: '#2F5BD3', sort: 0 } });
    const l2 = await tx.lane.create({ data: { tenantId: T, projectId: p.id, name: 'Rollout', color: '#0F6B5C', sort: 1 } });
    const spread = [10, -10, 5, -5];
    const titles = ['Requirements', 'Build', 'Testing', 'Handover'];
    for (let i = 0; i < 4; i++) {
      await tx.task.create({
        data: {
          tenantId: T,
          projectId: p.id,
          laneId: i < 2 ? l1.id : l2.id,
          title: titles[i],
          startDate: d(s),
          dueDate: d(e),
          estimateHours: 40,
          progress: Math.max(0, Math.min(100, prog + spread[i])),
          sort: i,
          assigneeAccountId: people[owner].id,
          createdById: people[owner].id,
        },
      });
    }
    const g = await tx.tollgate.create({ data: { tenantId: T, projectId: p.id, code: gate[0], name: gate[1], date: d(gate[2]), sort: 0 } });
    await tx.tollgateCriterion.create({ data: { tenantId: T, tollgateId: g.id, text: 'Steering group approval', met: false } });
    const post = await tx.budgetPost.create({ data: { tenantId: T, projectId: p.id, name: 'Project budget', amount: budget } });
    if (spent > 0) {
      await tx.cost.create({
        data: { tenantId: T, projectId: p.id, budgetPostId: post.id, supplier: 'Various suppliers', reference: 'Summary', amount: spent, date: d(-7), createdById: people[owner].id },
      });
    }
  }
}
