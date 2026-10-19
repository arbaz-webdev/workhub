import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_HEADER, type BoardDto, type TaskCardDto } from '@workhub/shared';
import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { createApp, PASSWORD, signUp, withAdmin } from './helpers';

let app: INestApplication;
let owner: Awaited<ReturnType<typeof signUp>>;
let member: Awaited<ReturnType<typeof signUp>>;
let guest: Awaited<ReturnType<typeof signUp>>;
let rival: Awaited<ReturnType<typeof signUp>>;
let ws: string;
let projectId: string;
let columns: BoardDto['columns'];

const H = () => ({ [WORKSPACE_HEADER]: ws });

async function join(person: typeof owner, role: string) {
  await withAdmin((db) =>
    db.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [ws, person.user.id, role]),
  );
}

async function board(agent = owner.agent): Promise<BoardDto> {
  return (await agent.get(`/projects/${projectId}`).set(H()).expect(200)).body;
}

async function addTask(title: string, columnId = columns[0]!.id): Promise<TaskCardDto> {
  return (await owner.agent.post(`/projects/${projectId}/tasks`).set(H()).send({ title, columnId }).expect(201)).body;
}

function titlesIn(b: BoardDto, columnId: string) {
  return b.tasks.filter((t) => t.columnId === columnId).sort((a, z) => a.position - z.position).map((t) => t.title);
}

beforeAll(async () => {
  app = await createApp();
  owner = await signUp(app, 'owner', 'Board Co');
  member = await signUp(app, 'member', 'Member Own Co');
  guest = await signUp(app, 'guest', 'Guest Own Co');
  rival = await signUp(app, 'rival', 'Rival Co');
  ws = owner.workspace.id;
  await join(member, 'member');
  await join(guest, 'guest');

  const client = await owner.agent.post('/companies').set(H()).send({ name: 'Northwind' }).expect(201);
  const project = await owner.agent
    .post('/projects')
    .set(H())
    .send({ name: 'Website rebuild', clientId: client.body.id, budgetHours: 120 })
    .expect(201);
  projectId = project.body.id;
  columns = (await board()).columns;
});

afterAll(async () => {
  await app.close();
});

describe('projects', () => {
  it('starts with four default columns and links the client', async () => {
    const b = await board();
    expect(b.columns.map((c) => c.name)).toEqual(['To do', 'In progress', 'Review', 'Done']);
    expect(b.project).toMatchObject({ name: 'Website rebuild', client: { name: 'Northwind' }, budgetHours: 120 });
    expect(b.canManage).toBe(true);
  });

  it('only managers and above create projects', async () => {
    await member.agent.post('/projects').set(H()).send({ name: 'Nope' }).expect(403);
  });

  it('rejects a client from another workspace', async () => {
    const theirs = await rival.agent.post('/companies').set(WORKSPACE_HEADER, rival.workspace.id).send({ name: 'Theirs' });
    await owner.agent.post('/projects').set(H()).send({ name: 'X', clientId: theirs.body.id }).expect(400);
  });
});

describe('cards and ordering', () => {
  it('adds cards to the bottom and reorders within a column', async () => {
    const col = columns[0]!.id;
    const a = await addTask('A');
    await addTask('B');
    await addTask('C');
    await owner.agent.post(`/tasks/${a.id}/move`).set(H()).send({ columnId: col, index: 2 }).expect(201);
    expect(titlesIn(await board(), col)).toEqual(['B', 'C', 'A']);
  });

  it('moves a card to another column at a given index and logs it', async () => {
    const doing = columns[1]!.id;
    const x = await addTask('X');
    const y = await addTask('Y');
    await owner.agent.post(`/tasks/${x.id}/move`).set(H()).send({ columnId: doing, index: 0 }).expect(201);
    await owner.agent.post(`/tasks/${y.id}/move`).set(H()).send({ columnId: doing, index: 0 }).expect(201);
    expect(titlesIn(await board(), doing)).toEqual(['Y', 'X']);
    const detail = await owner.agent.get(`/tasks/${x.id}`).set(H()).expect(200);
    expect(detail.body.activity[0]).toMatchObject({ type: 'task.moved', data: { from: 'To do', to: 'In progress' } });
  });

  it('keeps order when cards are squeezed between the same two neighbours many times', async () => {
    const review = columns[2]!.id;
    const first = await addTask('first');
    const last = await addTask('last');
    for (const t of [first, last]) await owner.agent.post(`/tasks/${t.id}/move`).set(H()).send({ columnId: review, index: 9 });
    const inserted: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      const t = await addTask(`n${i}`);
      // Always insert right after "first", halving the same gap each time.
      await owner.agent.post(`/tasks/${t.id}/move`).set(H()).send({ columnId: review, index: 1 }).expect(201);
      inserted.unshift(`n${i}`);
    }
    expect(titlesIn(await board(), review)).toEqual(['first', ...inserted, 'last']);
  });

  it('rejects moving into a column of another project', async () => {
    const other = await owner.agent.post('/projects').set(H()).send({ name: 'Other' }).expect(201);
    const otherCols = (await owner.agent.get(`/projects/${other.body.id}`).set(H())).body.columns;
    const t = await addTask('stay');
    await owner.agent.post(`/tasks/${t.id}/move`).set(H()).send({ columnId: otherCols[0].id, index: 0 }).expect(404);
  });
});

describe('task details', () => {
  let taskId: string;

  beforeAll(async () => {
    taskId = (await addTask('Design homepage')).id;
  });

  it('updates fields, labels and assignees, and notifies the assignee', async () => {
    const labels = await owner.agent.post(`/projects/${projectId}/labels`).set(H()).send({ name: 'Design', color: 'violet' }).expect(201);
    const res = await owner.agent
      .patch(`/tasks/${taskId}`)
      .set(H())
      .send({
        priority: 'high',
        dueDate: '2026-12-01',
        estimateHours: 6.5,
        description: 'Hero, features, pricing',
        labelIds: [labels.body[0].id],
        assigneeIds: [member.user.id],
      })
      .expect(200);
    expect(res.body).toMatchObject({ priority: 'high', dueDate: '2026-12-01', estimateHours: 6.5, assigneeIds: [member.user.id] });
    expect(res.body.labelIds).toEqual([labels.body[0].id]);

    const notes = await member.agent.get('/notifications').set(H()).expect(200);
    expect(notes.body.items[0]).toMatchObject({
      title: 'owner assigned you to "Design homepage"',
      link: `/app/projects/${projectId}?task=${taskId}`,
    });
  });

  it('refuses assignees and labels from outside the project', async () => {
    await owner.agent.patch(`/tasks/${taskId}`).set(H()).send({ assigneeIds: [rival.user.id] }).expect(400);
    // Guests must be added to the project before they can be assigned.
    await owner.agent.patch(`/tasks/${taskId}`).set(H()).send({ assigneeIds: [guest.user.id] }).expect(400);
    const other = await owner.agent.post('/projects').set(H()).send({ name: 'Labels elsewhere' }).expect(201);
    const foreign = await owner.agent.post(`/projects/${other.body.id}/labels`).set(H()).send({ name: 'X', color: 'red' });
    await owner.agent.patch(`/tasks/${taskId}`).set(H()).send({ labelIds: [foreign.body[0].id] }).expect(400);
  });

  it('tracks checklist and subtasks on the card', async () => {
    const withItem = await owner.agent.post(`/tasks/${taskId}/checklist`).set(H()).send({ text: 'Wireframe' }).expect(201);
    await owner.agent.post(`/tasks/${taskId}/checklist`).set(H()).send({ text: 'Copy' }).expect(201);
    await owner.agent.patch(`/tasks/${taskId}/checklist/${withItem.body.checklist[0].id}`).set(H()).send({ done: true }).expect(200);
    const sub = await owner.agent.post(`/projects/${projectId}/tasks`).set(H()).send({ title: 'Mobile layout', parentTaskId: taskId }).expect(201);
    await owner.agent.patch(`/tasks/${sub.body.id}`).set(H()).send({ completed: true }).expect(200);

    const card = (await board()).tasks.find((t) => t.id === taskId)!;
    expect(card).toMatchObject({ checklistDone: 1, checklistTotal: 2, subtasksDone: 1, subtasksTotal: 1 });
    // Subtasks never appear as board cards.
    expect((await board()).tasks.some((t) => t.title === 'Mobile layout')).toBe(false);
  });

  it('completes and reopens a task', async () => {
    await owner.agent.patch(`/tasks/${taskId}`).set(H()).send({ completed: true }).expect(200);
    expect((await board()).tasks.find((t) => t.id === taskId)!.completed).toBe(true);
    await owner.agent.patch(`/tasks/${taskId}`).set(H()).send({ completed: false }).expect(200);
  });
});

describe('comments and mentions', () => {
  it('notifies people mentioned, ignores strangers, and tells assignees', async () => {
    const t = await addTask('Pricing page');
    await owner.agent.patch(`/tasks/${t.id}`).set(H()).send({ assigneeIds: [member.user.id] }).expect(200);
    await owner.agent.post(`/projects/${projectId}/members`).set(H()).send({ userId: guest.user.id }).expect(204);

    const res = await owner.agent
      .post(`/tasks/${t.id}/comments`)
      .set(H())
      .send({ body: '@guest can you check the prices?', mentions: [guest.user.id, rival.user.id] })
      .expect(201);
    expect(res.body.comments[0]).toMatchObject({ body: '@guest can you check the prices?', mentions: [guest.user.id] });

    const guestNotes = await guest.agent.get('/notifications').set(H()).expect(200);
    expect(guestNotes.body.items.map((n: { title: string }) => n.title)).toContain('owner mentioned you on "Pricing page"');
    const memberNotes = await member.agent.get('/notifications').set(H()).expect(200);
    expect(memberNotes.body.items[0].title).toBe('owner commented on "Pricing page"');
  });

  it('only the author can delete a comment', async () => {
    const t = await addTask('Comment owner');
    const c = await member.agent.post(`/tasks/${t.id}/comments`).set(H()).send({ body: 'mine' }).expect(201);
    const commentId = c.body.comments[0].id;
    await owner.agent.delete(`/tasks/${t.id}/comments/${commentId}`).set(H()).expect(403);
    await member.agent.delete(`/tasks/${t.id}/comments/${commentId}`).set(H()).expect(200);
  });
});

describe('guests', () => {
  it('see only projects they were added to, and can comment but not edit', async () => {
    const hidden = await owner.agent.post('/projects').set(H()).send({ name: 'Internal only' }).expect(201);
    const list = await guest.agent.get('/projects').set(H()).expect(200);
    expect(list.body.map((p: { name: string }) => p.name)).toEqual(['Website rebuild']);
    await guest.agent.get(`/projects/${hidden.body.id}`).set(H()).expect(404);
    await guest.agent.get('/companies').set(H()).expect(403);

    const b = await board(guest.agent);
    expect(b).toMatchObject({ canEdit: false, canManage: false });
    const t = b.tasks[0]!;
    await guest.agent.post(`/tasks/${t.id}/comments`).set(H()).send({ body: 'Looks good' }).expect(201);
    await guest.agent.patch(`/tasks/${t.id}`).set(H()).send({ title: 'hijack' }).expect(403);
    await guest.agent.post(`/projects/${projectId}/tasks`).set(H()).send({ title: 'new' }).expect(403);
    await guest.agent.post(`/tasks/${t.id}/move`).set(H()).send({ columnId: columns[3]!.id, index: 0 }).expect(403);
  });
});

describe('columns', () => {
  it('members cannot change columns; managers add, rename, reorder and delete empty ones', async () => {
    await member.agent.post(`/projects/${projectId}/columns`).set(H()).send({ name: 'Blocked' }).expect(403);
    const added = await owner.agent.post(`/projects/${projectId}/columns`).set(H()).send({ name: 'Blocked' }).expect(201);
    const blocked = added.body.at(-1);
    expect(blocked.name).toBe('Blocked');

    const moved = await owner.agent.post(`/projects/${projectId}/columns/${blocked.id}/move`).set(H()).send({ index: 1 }).expect(201);
    expect(moved.body.map((c: { name: string }) => c.name)).toEqual(['To do', 'Blocked', 'In progress', 'Review', 'Done']);

    await owner.agent.patch(`/projects/${projectId}/columns/${blocked.id}`).set(H()).send({ name: 'On hold', wipLimit: 3 }).expect(200);
    await owner.agent.delete(`/projects/${projectId}/columns/${columns[0]!.id}`).set(H()).expect(409); // has tasks
    const after = await owner.agent.delete(`/projects/${projectId}/columns/${blocked.id}`).set(H()).expect(200);
    expect(after.body).toHaveLength(4);
  });
});

describe('isolation', () => {
  it("another company can't read or change our projects or tasks", async () => {
    const t = await addTask('secret');
    const rivalH = { [WORKSPACE_HEADER]: rival.workspace.id };
    await rival.agent.get(`/projects/${projectId}`).set(rivalH).expect(404);
    await rival.agent.get(`/tasks/${t.id}`).set(rivalH).expect(404);
    await rival.agent.patch(`/tasks/${t.id}`).set(rivalH).send({ title: 'pwned' }).expect(404);
    await rival.agent.post(`/tasks/${t.id}/comments`).set(rivalH).send({ body: 'hi' }).expect(404);
    await rival.agent.get(`/projects/${projectId}`).set(H()).expect(403);
    expect((await rival.agent.get('/projects').set(rivalH)).body).toEqual([]);
  });
});

describe('live updates', () => {
  it('pushes a moved card to another viewer within a second', async () => {
    const server = app.getHttpServer();
    if (!server.listening) await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;

    // Second viewer: the member, on their own connection.
    const signIn = await request(server).post('/auth/sign-in').send({ email: member.email, password: PASSWORD }).expect(200);
    const cookie = (signIn.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');

    const t = await addTask('Live card');
    let movedAt = 0;
    const received = new Promise<{ type: string; task?: TaskCardDto }>((resolve, reject) => {
      const req = get(
        { port, path: `/projects/${projectId}/events?workspace=${ws}`, headers: { cookie, accept: 'text/event-stream' } },
        (res) => {
          expect(res.statusCode).toBe(200);
          let buffer = '';
          let opened = false;
          res.on('data', (chunk) => {
            if (!opened) {
              // The stream is subscribed once the first bytes arrive; now make the change.
              opened = true;
              movedAt = Date.now();
              void owner.agent.post(`/tasks/${t.id}/move`).set(H()).send({ columnId: columns[3]!.id, index: 0 }).then(() => undefined); // supertest only sends once awaited/then'd
            }
            buffer += chunk.toString();
            // Only complete events (ending in a blank line); keep the partial tail for later.
            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() ?? '';
            for (const block of blocks) {
              const line = block.split('\n').find((l) => l.startsWith('data: '));
              if (!line || line === 'data: ') continue; // heartbeat
              const event = JSON.parse(line.slice(6));
              if (event.type === 'task.upserted' && event.task.id === t.id) {
                req.destroy();
                resolve(event);
              }
            }
          });
        },
      );
      req.on('error', (e) => (e.message.includes('socket hang up') ? undefined : reject(e)));
    });

    const event = await received;
    expect(Date.now() - movedAt).toBeLessThan(1000);
    expect(event.task).toMatchObject({ id: t.id, columnId: columns[3]!.id });
  });

  it('refuses the stream to people outside the workspace', async () => {
    await rival.agent.get(`/projects/${projectId}/events`).query({ workspace: ws }).expect(403);
  });
});
