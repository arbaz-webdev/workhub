import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_HEADER, type BoardDto, type TaskCardDto, type TaskDetailDto } from '@workhub/shared';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createApp, signUp, withAdmin } from './helpers';

let app: INestApplication;
let owner: Awaited<ReturnType<typeof signUp>>;
let member: Awaited<ReturnType<typeof signUp>>;
let guest: Awaited<ReturnType<typeof signUp>>;
let rival: Awaited<ReturnType<typeof signUp>>;
let ws: string;

const H = () => ({ [WORKSPACE_HEADER]: ws });

async function join_(person: typeof owner, role: string) {
  await withAdmin((db) => db.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [ws, person.user.id, role]));
}

async function newProject(name: string, extra: Record<string, unknown> = {}): Promise<BoardDto> {
  const p = await owner.agent.post('/projects').set(H()).send({ name, ...extra }).expect(201);
  return (await owner.agent.get(`/projects/${p.body.id}`).set(H()).expect(200)).body;
}

async function addTask(projectId: string, title: string, agent = owner.agent): Promise<TaskCardDto> {
  return (await agent.post(`/projects/${projectId}/tasks`).set(H()).send({ title }).expect(201)).body;
}

async function notificationTitles(agent = owner.agent) {
  return (await agent.get('/notifications').set(H()).expect(200)).body.items.map((n: { title: string }) => n.title);
}

beforeAll(async () => {
  app = await createApp();
  owner = await signUp(app, 'owner', 'Sprint Four Co');
  member = await signUp(app, 'member', 'Member Home');
  guest = await signUp(app, 'guest', 'Guest Home');
  rival = await signUp(app, 'rival', 'Rival Co');
  ws = owner.workspace.id;
  await join_(member, 'member');
  await join_(guest, 'guest');
});

afterAll(async () => {
  await app.close();
});

describe('time logging and actual hours', () => {
  it('rolls logged time up to the card, including subtasks', async () => {
    const b = await newProject('Time');
    const t = await addTask(b.project.id, 'Build homepage');
    await owner.agent.post(`/tasks/${t.id}/time`).set(H()).send({ minutes: 90, note: 'Layout' }).expect(201);
    const sub = await owner.agent.post(`/projects/${b.project.id}/tasks`).set(H()).send({ title: 'Mobile', parentTaskId: t.id }).expect(201);
    await member.agent.post(`/tasks/${sub.body.id}/time`).set(H()).send({ minutes: 30 }).expect(201);

    const board = (await owner.agent.get(`/projects/${b.project.id}`).set(H())).body as BoardDto;
    expect(board.tasks.find((c) => c.id === t.id)!.actualHours).toBe(2);
    expect(board.project.actualHours).toBe(2);

    const detail = (await owner.agent.get(`/tasks/${t.id}`).set(H())).body as TaskDetailDto;
    expect(detail.timeEntries[0]).toMatchObject({ minutes: 90, note: 'Layout', billable: true });
    expect(detail.timeEntries[0]!.workDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(detail.activity[0]).toMatchObject({ type: 'time.logged' });
  });

  it('people remove their own time; managers can remove anyone’s; guests cannot log', async () => {
    const b = await newProject('Time rules');
    await owner.agent.post(`/projects/${b.project.id}/members`).set(H()).send({ userId: guest.user.id }).expect(204);
    const t = await addTask(b.project.id, 'Task');
    const mine = await member.agent.post(`/tasks/${t.id}/time`).set(H()).send({ minutes: 15 }).expect(201);
    const entryId = mine.body.timeEntries[0].id;
    const ownerEntry = await owner.agent.post(`/tasks/${t.id}/time`).set(H()).send({ minutes: 20 }).expect(201);
    const ownerEntryId = ownerEntry.body.timeEntries.find((e: { minutes: number }) => e.minutes === 20).id;

    await member.agent.delete(`/tasks/${t.id}/time/${ownerEntryId}`).set(H()).expect(403);
    await owner.agent.delete(`/tasks/${t.id}/time/${entryId}`).set(H()).expect(200);
    await guest.agent.post(`/tasks/${t.id}/time`).set(H()).send({ minutes: 5 }).expect(403);
    await owner.agent.post(`/tasks/${t.id}/time`).set(H()).send({ minutes: 0 }).expect(400);
    await owner.agent.post(`/tasks/${t.id}/time`).set(H()).send({ minutes: 25 * 60 }).expect(400);
    await owner.agent.post(`/tasks/${t.id}/time`).set(H()).send({ minutes: 10, workDate: '2026-02-30' }).expect(400);
    const dated = await owner.agent.post(`/tasks/${t.id}/time`).set(H()).send({ minutes: 10, workDate: '2026-10-01' }).expect(201);
    expect(dated.body.timeEntries.map((e: { workDate: string }) => e.workDate)).toContain('2026-10-01');
  });
});

describe('budget alerts', () => {
  it('warns once at 80%, once when over budget, and re-arms when the budget changes', async () => {
    const b = await newProject('Budgeted', { budgetHours: 2 });
    const t = await addTask(b.project.id, 'Work');
    const log = (minutes: number) => member.agent.post(`/tasks/${t.id}/time`).set(H()).send({ minutes }).expect(201);

    await log(60); // 50%
    expect(await notificationTitles()).not.toContain('Budgeted has used 80% of its budget');
    await log(40); // 83%
    expect((await notificationTitles()).filter((n: string) => n === 'Budgeted has used 80% of its budget')).toHaveLength(1);
    await log(10); // 92%: no repeat
    expect((await notificationTitles()).filter((n: string) => n === 'Budgeted has used 80% of its budget')).toHaveLength(1);
    await log(20); // 108%
    expect((await notificationTitles()).filter((n: string) => n === 'Budgeted is over budget')).toHaveLength(1);
    // The member who logged isn't a manager or admin, so they get no budget alerts.
    expect(await notificationTitles(member.agent)).not.toContain('Budgeted is over budget');

    // Raising the budget re-arms the alerts; dropping below again warns again.
    await owner.agent.patch(`/projects/${b.project.id}`).set(H()).send({ budgetHours: 10 }).expect(200);
    await owner.agent.patch(`/projects/${b.project.id}`).set(H()).send({ budgetHours: 2.5 }).expect(200); // 2.17h of 2.5h = 87%
    expect((await notificationTitles()).filter((n: string) => n === 'Budgeted has used 80% of its budget')).toHaveLength(2);
  });
});

describe('attachments', () => {
  let projectId: string;
  let taskId: string;

  beforeAll(async () => {
    const b = await newProject('Files');
    projectId = b.project.id;
    await owner.agent.post(`/projects/${projectId}/members`).set(H()).send({ userId: guest.user.id }).expect(204);
    taskId = (await addTask(projectId, 'Brief')).id;
  });

  it('uploads, lists and downloads a file as an attachment', async () => {
    const res = await member.agent
      .post(`/tasks/${taskId}/attachments`)
      .set(H())
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'brief.html', contentType: 'text/html' })
      .expect(201);
    const file = res.body.attachments[0];
    expect(file).toMatchObject({ fileName: 'brief.html', sizeBytes: 25, isImage: false, uploadedByName: 'member' });

    const dl = await guest.agent.get(file.url).expect(200); // guests on the project can download
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['content-type']).toBe('application/octet-stream'); // never rendered as HTML
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
  });

  it('shows images inline and keeps Urdu file names', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
    const res = await owner.agent
      .post(`/tasks/${taskId}/attachments`)
      .set(H())
      .attach('file', png, { filename: 'لوگو.png', contentType: 'image/png' })
      .expect(201);
    const file = res.body.attachments.find((a: { fileName: string }) => a.fileName === 'لوگو.png');
    expect(file.isImage).toBe(true);
    const dl = await owner.agent.get(file.url).expect(200);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(dl.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('لوگو.png')}`);
  });

  it('rejects files over 25 MB', async () => {
    await owner.agent
      .post(`/tasks/${taskId}/attachments`)
      .set(H())
      .attach('file', Buffer.alloc(25 * 1024 * 1024 + 1), { filename: 'big.bin' })
      .expect(413);
  });

  it("keeps files private to the workspace", async () => {
    const detail = (await owner.agent.get(`/tasks/${taskId}`).set(H())).body as TaskDetailDto;
    const file = detail.attachments[0]!;
    const id = file.id;
    await rival.agent.get(`/attachments/${id}`).query({ workspace: rival.workspace.id }).expect(404);
    await rival.agent.get(file.url).expect(403);
  });

  it('only the uploader or a manager removes a file, and the stored bytes go too', async () => {
    const res = await member.agent
      .post(`/tasks/${taskId}/attachments`)
      .set(H())
      .attach('file', Buffer.from('notes'), { filename: 'notes.txt', contentType: 'text/plain' })
      .expect(201);
    const file = res.body.attachments.find((a: { fileName: string }) => a.fileName === 'notes.txt');
    const dir = join(process.env.LOCAL_STORAGE_DIR!, ws, taskId);
    const before = readdirSync(dir).length;

    await guest.agent.delete(`/tasks/${taskId}/attachments/${file.id}`).set(H()).expect(403);
    const otherMember = await signUp(app, 'other', 'Other Home');
    await join_(otherMember, 'member');
    await otherMember.agent.delete(`/tasks/${taskId}/attachments/${file.id}`).set(H()).expect(403);
    await member.agent.delete(`/tasks/${taskId}/attachments/${file.id}`).set(H()).expect(200);
    expect(readdirSync(dir).length).toBe(before - 1);
    expect(existsSync(dir)).toBe(true);
  });
});

describe('My Work', () => {
  it('lists my open tasks across projects, in this workspace only', async () => {
    const a = await newProject('Alpha');
    const b = await newProject('Beta');
    const t1 = await addTask(a.project.id, 'Due soon');
    const t2 = await addTask(b.project.id, 'No date');
    const t3 = await addTask(b.project.id, 'Already done');
    for (const t of [t1, t2, t3]) await owner.agent.patch(`/tasks/${t.id}`).set(H()).send({ assigneeIds: [member.user.id] }).expect(200);
    await owner.agent.patch(`/tasks/${t1.id}`).set(H()).send({ dueDate: '2026-01-01' }).expect(200);
    await owner.agent.patch(`/tasks/${t3.id}`).set(H()).send({ completed: true }).expect(200);

    const res = await member.agent.get('/me/tasks').set(H()).expect(200);
    expect(res.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const titles = res.body.tasks.map((t: { title: string }) => t.title);
    expect(titles).toContain('Due soon');
    expect(titles).toContain('No date');
    expect(titles).not.toContain('Already done');
    // Dated tasks come first.
    expect(titles.indexOf('Due soon')).toBeLessThan(titles.indexOf('No date'));
    expect(res.body.tasks.find((t: { title: string }) => t.title === 'Due soon')).toMatchObject({ projectName: 'Alpha', columnName: 'To do' });

    // Member's own workspace shows none of these.
    const home = await member.agent.get('/me/tasks').set(WORKSPACE_HEADER, member.workspace.id).expect(200);
    expect(home.body.tasks).toEqual([]);
  });
});

describe('bulk edit', () => {
  it('moves, assigns, labels, completes and deletes many cards at once', async () => {
    const b = await newProject('Bulk');
    const ids: string[] = [];
    for (const title of ['one', 'two', 'three']) ids.push((await addTask(b.project.id, title)).id);
    const done = b.columns.at(-1)!.id;
    const label = (await owner.agent.post(`/projects/${b.project.id}/labels`).set(H()).send({ name: 'Q4', color: 'teal' })).body[0];
    const bulk = (action: Record<string, unknown>, taskIds = ids) =>
      owner.agent.post(`/projects/${b.project.id}/tasks/bulk`).set(H()).send({ taskIds, action });

    await bulk({ type: 'move', columnId: done }).expect(200);
    await bulk({ type: 'assign', userId: member.user.id }).expect(200);
    await bulk({ type: 'priority', priority: 'urgent' }).expect(200);
    await bulk({ type: 'label', labelId: label.id }).expect(200);
    await bulk({ type: 'due', dueDate: '2026-11-30' }).expect(200);
    await bulk({ type: 'due', dueDate: '2026-02-31' }).expect(400);
    await bulk({ type: 'complete', completed: true }).expect(200);

    const board = (await owner.agent.get(`/projects/${b.project.id}`).set(H())).body as BoardDto;
    const cards = board.tasks.filter((t) => ids.includes(t.id)).sort((x, y) => x.position - y.position);
    expect(cards.map((c) => c.title)).toEqual(['one', 'two', 'three']); // order kept
    for (const c of cards) {
      expect(c).toMatchObject({ columnId: done, priority: 'urgent', completed: true, dueDate: '2026-11-30', assigneeIds: [member.user.id], labelIds: [label.id] });
    }
    expect(await notificationTitles(member.agent)).toContain('You were assigned 3 tasks in Bulk');

    await bulk({ type: 'delete' }, ids.slice(0, 2)).expect(200);
    const after = (await owner.agent.get(`/projects/${b.project.id}`).set(H())).body as BoardDto;
    expect(after.tasks.map((t) => t.title)).toEqual(['three']);
  });

  it('refuses cards from another project and guests', async () => {
    const a = await newProject('Bulk A');
    const other = await newProject('Bulk B');
    const foreign = await addTask(other.project.id, 'foreign');
    await owner.agent
      .post(`/projects/${a.project.id}/tasks/bulk`)
      .set(H())
      .send({ taskIds: [foreign.id], action: { type: 'priority', priority: 'low' } })
      .expect(400);
    await guest.agent
      .post(`/projects/${a.project.id}/tasks/bulk`)
      .set(H())
      .send({ taskIds: [foreign.id], action: { type: 'delete' } })
      .expect(403);
  });
});

describe('templates', () => {
  it('creates a project from a built-in template', async () => {
    const list = await member.agent.get('/project-templates').set(H()).expect(200);
    expect(list.body.map((t: { id: string }) => t.id)).toContain('builtin:website');

    const b = await newProject('Client site', { templateId: 'builtin:website' });
    expect(b.columns.map((c) => c.name)).toEqual(['Backlog', 'Design', 'Development', 'Client review', 'Done']);
    expect(b.labels.map((l) => l.name).sort()).toEqual(['Client', 'Content', 'Design', 'Frontend']);
    expect(b.tasks.map((t) => t.title)).toContain('Launch and handover');
    expect(b.tasks.find((t) => t.title === 'Launch and handover')!.checklistTotal).toBe(4);
    expect(b.tasks.find((t) => t.title === 'Homepage design')!.estimateHours).toBe(8);
  });

  it('saves a project as a template and reuses it', async () => {
    const src = await newProject('Source');
    const t = await addTask(src.project.id, 'Repeatable step');
    await owner.agent.post(`/tasks/${t.id}/checklist`).set(H()).send({ text: 'Check one' }).expect(201);
    await owner.agent.post(`/projects/${src.project.id}/columns`).set(H()).send({ name: 'Blocked' }).expect(201);

    await member.agent.post(`/projects/${src.project.id}/save-as-template`).set(H()).send({ name: 'Nope' }).expect(403);
    const saved = await owner.agent.post(`/projects/${src.project.id}/save-as-template`).set(H()).send({ name: 'Our process' }).expect(201);
    expect(saved.body).toMatchObject({ name: 'Our process', builtin: false, taskCount: 1, columns: ['To do', 'In progress', 'Review', 'Done', 'Blocked'] });

    const copy = await newProject('From saved', { templateId: saved.body.id });
    expect(copy.columns.map((c) => c.name)).toContain('Blocked');
    expect(copy.tasks.find((x) => x.title === 'Repeatable step')!.checklistTotal).toBe(1);

    // Templates are private to the workspace.
    await rival.agent.post('/projects').set(WORKSPACE_HEADER, rival.workspace.id).send({ name: 'Steal', templateId: saved.body.id }).expect(400);
    await owner.agent.delete(`/project-templates/${saved.body.id}`).set(H()).expect(204);
    await owner.agent.post('/projects').set(H()).send({ name: 'Gone', templateId: saved.body.id }).expect(400);
    await owner.agent.post('/projects').set(H()).send({ name: 'Bad', templateId: 'builtin:nope' }).expect(400);
  });
});
