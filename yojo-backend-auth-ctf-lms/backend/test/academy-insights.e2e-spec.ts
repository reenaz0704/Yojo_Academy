import { makeStaff, makeStudent, startApp, type StaffUser, type TestCtx } from './helpers';

/**
 * Slice (i): Trainer and Admin LMS read models. Batch overview numbers come only from recorded rows (attendance
 * marks here), parts without data are left out of the performance index, flags follow the policy, and trainers see
 * only their own batches.
 */
describe('Admin/Trainer LMS: dashboards and batch overview', () => {
  let ctx: TestCtx;
  let admin: StaffUser, trainer: StaffUser, otherTrainer: StaffUser;
  let st: Awaited<ReturnType<typeof makeStudent>>, mate: Awaited<ReturnType<typeof makeStudent>>;
  let batchId: string;
  const H = 3600_000;
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    trainer = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    otherTrainer = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    st = await makeStudent(ctx);
    mate = await makeStudent(ctx);
    const b = await admin.client.post('/admin/batches', {
      code: `IN-${Date.now().toString(36)}`,
      name: 'Insights batch',
      trainerId: trainer.id,
      status: 'active',
    });
    batchId = b.body.id;
    for (const s of [st, mate]) await admin.client.post(`/admin/students/${s.id}/enrolments`, { batchId });
  });
  afterAll(async () => ctx.app.close());

  it('a new batch has no attendance, so no index and no attendance flag', async () => {
    const o = await trainer.client.get(`/trainer/batches/${batchId}/overview`);
    expect(o.status).toBe(200);
    expect(o.body.summary).toMatchObject({ students: 2, attendanceAvg: null, performanceAvg: null, flagged: 0 });
    const row = o.body.students.find((r: { studentId: string }) => r.studentId === st.id);
    expect(row).toMatchObject({ quizAvg: null, labsCleared: 0, xp: 0, performanceIndex: null, performanceParts: [] });
    expect(row.flags).toEqual([]);
  });

  it('attendance marks drive the index and the low-attendance flag', async () => {
    const mk = async (title: string, at: number) =>
      (
        await trainer.client.post('/trainer/sessions', {
          batchId,
          type: 'class',
          title,
          startsAt: iso(at),
          endsAt: iso(at + H),
        })
      ).body.id as string;
    const s1 = await mk('Packet basics', -30 * H);
    const s2 = await mk('Packet filters', -28 * H);
    for (const id of [s1, s2])
      await trainer.client.send('put', `/trainer/sessions/${id}/attendance`, {
        marks: [
          { studentId: st.id, mark: 'present' },
          { studentId: mate.id, mark: id === s1 ? 'present' : 'absent' },
        ],
      });
    const o = (await trainer.client.get(`/trainer/batches/${batchId}/overview`)).body;
    const me = o.students.find((r: { studentId: string }) => r.studentId === st.id);
    const m = o.students.find((r: { studentId: string }) => r.studentId === mate.id);
    expect(me).toMatchObject({ performanceIndex: 100, performanceParts: ['attendance'], flags: [] });
    expect(me.attendance.pct).toBe(100);
    expect(m.attendance.pct).toBe(50);
    expect(m.flags).toEqual(o.requiredAttendancePct > 50 ? ['Low attendance'] : []);
    expect(o.summary.attendanceAvg).toBe(75);
  });

  it('trainers see only their own batches; admins need the reports permission path', async () => {
    expect((await otherTrainer.client.get(`/trainer/batches/${batchId}/overview`)).status).toBe(404);
    expect((await st.client.get(`/trainer/batches/${batchId}/overview`)).status).toBe(403);
    const a = await admin.client.get(`/admin/lms/batches/${batchId}/overview`);
    expect(a.status).toBe(200);
    expect(a.body.summary.students).toBe(2);
    expect((await trainer.client.get(`/admin/lms/batches/${batchId}/overview`)).status).toBe(403);
  });

  it('trainer dashboard counts what is waiting for this trainer only', async () => {
    const day = new Date(Date.now() + 60 * H).toISOString().slice(0, 10);
    await st.client.post('/student/leave-requests', { from: day, to: day, reason: 'College exam day' });
    await st.client.post('/student/conversations', { staffId: trainer.id, subject: 'Doubt', body: 'About filters' });
    const d = (await trainer.client.get('/trainer/dashboard')).body;
    expect(d.batches.map((b: { id: string }) => b.id)).toEqual([batchId]);
    expect(d.pending).toMatchObject({ leave: 1, unreadMessages: 1, bookings: 0, toGrade: 0, placementReviews: 0 });
    const other = (await otherTrainer.client.get('/trainer/dashboard')).body;
    expect(other.pending).toMatchObject({ leave: 0, unreadMessages: 0 });
  });

  it('admin LMS dashboard tiles', async () => {
    const d = await admin.client.get('/admin/lms/dashboard');
    expect(d.status).toBe(200);
    expect(d.body.students).toBeGreaterThanOrEqual(2);
    expect(d.body.pending.leave).toBeGreaterThanOrEqual(1);
    expect((await trainer.client.get('/admin/lms/dashboard')).status).toBe(403);
  });
});
