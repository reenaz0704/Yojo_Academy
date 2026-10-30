import { makeStaff, makeStudent, startApp, type StaffUser, type TestCtx } from './helpers';

/** Trainer "Post to batch" (restored 29 Oct): own batches only; students see it under Trainer announcements. */
describe('Trainer announcements', () => {
  let ctx: TestCtx;
  let admin: StaffUser, a: StaffUser, b: StaffUser;
  let st: Awaited<ReturnType<typeof makeStudent>>, other: Awaited<ReturnType<typeof makeStudent>>;
  let batchA = '';
  const tag = Date.now().toString(36).toUpperCase();

  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    a = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    b = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    st = await makeStudent(ctx);
    other = await makeStudent(ctx);
    batchA = (
      await admin.client.post('/admin/batches', {
        code: `AN-${tag}`,
        name: 'Announcements batch',
        trainerId: a.id,
        status: 'active',
      })
    ).body.id;
    await admin.client.post(`/admin/students/${st.id}/enrolments`, { batchId: batchA });
  });
  afterAll(async () => ctx.app.close());

  it('posts to the trainer’s own batch only and keeps a history', async () => {
    const body = { title: 'Bring your SIEM login', body: 'Tonight’s class uses the SIEM sandbox.' };
    expect((await b.client.post(`/trainer/batches/${batchA}/announcements`, body)).status).toBe(404);
    expect((await st.client.post(`/trainer/batches/${batchA}/announcements`, body)).status).toBe(403);
    const r = await a.client.post(`/trainer/batches/${batchA}/announcements`, body);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ recipients: 1, batch: `AN-${tag}` });
    const h = await a.client.get('/trainer/announcements');
    expect(h.body[0]).toMatchObject({ batch: `AN-${tag}`, title: body.title, recipients: 1 });
    expect((await b.client.get('/trainer/announcements')).body).toEqual([]);
  });

  it('students of the batch see it; others do not', async () => {
    const mine = await st.client.get('/student/announcements');
    expect(mine.body[0]).toMatchObject({ title: 'Bring your SIEM login' });
    expect((await other.client.get('/student/announcements')).body).toEqual([]);
  });
});
