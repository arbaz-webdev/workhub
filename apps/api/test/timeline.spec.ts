import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_HEADER, type BoardDto, type TaskCardDto, type TaskDetailDto } from '@workhub/shared';
import { createApp, signUp, withAdmin } from './helpers';

let app: INestApplication;

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  await app.close();
});

describe('Task start dates (calendar and timeline)', () => {
  it('keeps a start date on or before the due date, and shows it on the board', async () => {
    const owner = await signUp(app, 'towner', 'Timeline Co');
    const H = [WORKSPACE_HEADER, owner.workspace.id] as const;
    const project = (await owner.agent.post('/projects').set(...H).send({ name: 'Launch' }).expect(201)).body as { id: string };
    const task = (await owner.agent.post(`/projects/${project.id}/tasks`).set(...H).send({ title: 'Build pages' }).expect(201)).body as TaskCardDto;
    expect(task.startDate).toBeNull();

    const both = (await owner.agent.patch(`/tasks/${task.id}`).set(...H).send({ startDate: '2027-06-07', dueDate: '2027-06-11' }).expect(200)).body as TaskDetailDto;
    expect(both).toMatchObject({ startDate: '2027-06-07', dueDate: '2027-06-11' });

    // Out of order, whichever side changes.
    await owner.agent.patch(`/tasks/${task.id}`).set(...H).send({ startDate: '2027-06-12' }).expect(400);
    await owner.agent.patch(`/tasks/${task.id}`).set(...H).send({ dueDate: '2027-06-06' }).expect(400);
    await owner.agent.patch(`/tasks/${task.id}`).set(...H).send({ startDate: '2027-06-12', dueDate: '2027-06-11' }).expect(400);
    await owner.agent.patch(`/tasks/${task.id}`).set(...H).send({ startDate: 'June 7' }).expect(400);
    // Moving both together, as a drag on the timeline does.
    await owner.agent.patch(`/tasks/${task.id}`).set(...H).send({ startDate: '2027-06-14', dueDate: '2027-06-18' }).expect(200);
    // The same day is fine; so is a start with no due date.
    await owner.agent.patch(`/tasks/${task.id}`).set(...H).send({ startDate: '2027-06-18' }).expect(200);
    await owner.agent.patch(`/tasks/${task.id}`).set(...H).send({ dueDate: null }).expect(200);

    const board = (await owner.agent.get(`/projects/${project.id}`).set(...H).expect(200)).body as BoardDto;
    const card = board.tasks.find((t) => t.id === task.id)!;
    expect(card).toMatchObject({ startDate: '2027-06-18', dueDate: null });

    // The database refuses an out-of-order pair too.
    await expect(withAdmin((db) => db.query("update tasks set start_date = '2027-07-02', due_date = '2027-07-01' where id = $1", [task.id]))).rejects.toThrow(/tasks_dates_in_order/);
  });
});
