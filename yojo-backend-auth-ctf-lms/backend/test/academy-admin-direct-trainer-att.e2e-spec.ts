import { makeStaff, makeStudent, startApp, type StaffUser, type TestCtx } from './helpers';

/**
 * Owner (30 Oct): Admin → Notifications can message one student (e.g. fee dues), and Admin → Attendance shows
 * trainer attendance: admin marks, or "present" from class records when the trainer took attendance that day.
 */
describe('Admin: direct student messages and trainer attendance', () => {
  let ctx: TestCtx;
  let admin: StaffUser, trainer: StaffUser, idle: StaffUser;
  let st: Awaited<ReturnType<typeof makeStudent>>, other: Awaited<ReturnType<typeof makeStudent>>;
  const tag = Date.now().toString(36).toUpperCase();
  const H = 3600_000;
  const istDay = (t: number) => new Date(t + 5.5 * H).toISOString().slice(0, 10);
  let classDay = '';

  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    trainer = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    idle = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    st = await makeStudent(ctx);
    other = await makeStudent(ctx);
    const b = await admin.client.post('/admin/batches', {
      code: `TA-${tag}`,
      name: 'Trainer attendance batch',
      trainerId: trainer.id,
      status: 'active',
    });
    await admin.client.post(`/admin/students/${st.id}/enrolments`, { batchId: b.body.id });
    const start = Date.now() - 30 * H;
    classDay = istDay(start);
    const s = await trainer.client.post('/trainer/sessions', {
      batchId: b.body.id,
      type: 'class',
      title: 'Log analysis',
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + H).toISOString(),
    });
    expect(s.status).toBe(201);
    await trainer.client.send('put', `/trainer/sessions/${s.body.id}/attendance`, {
      marks: [{ studentId: st.id, mark: 'present' }],
    });
  });
  afterAll(async () => ctx.app.close());

  it('sends a message to one student only, audited, with a history', async () => {
    const body = {
      studentId: st.id,
      category: 'fee_dues',
      title: 'Fee instalment due',
      body: 'Your second instalment is due on 5 Nov.',
    };
    expect((await trainer.client.post('/admin/notifications/direct', body)).status).toBe(403);
    expect((await admin.client.post('/admin/notifications/direct', { ...body, category: 'spam' })).status).toBe(400);
    expect((await admin.client.post('/admin/notifications/direct', { ...body, studentId: trainer.id })).status).toBe(
      404,
    );
    const r = await admin.client.post('/admin/notifications/direct', body);
    expect(r.status).toBe(201);
    expect(r.body.recipients).toBe(1);
    const mine = await st.client.get('/me/notifications');
    expect(JSON.stringify(mine.body)).toContain('Fee instalment due');
    expect(JSON.stringify((await other.client.get('/me/notifications')).body)).not.toContain('Fee instalment due');
    const h = await admin.client.get('/admin/notifications/direct');
    expect(h.body[0]).toMatchObject({ category: 'fee_dues', title: 'Fee instalment due' });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'admin.notification.direct', targetId: st.id } })).toBe(
      1,
    );
  });

  it('trainer attendance: present from class records, admin marks, reason to change', async () => {
    const d = await admin.client.get(`/admin/trainer-attendance?day=${classDay}`);
    expect(d.status).toBe(200);
    const row = (id: string, x = d) => x.body.trainers.find((t: { id: string }) => t.id === id);
    expect(row(trainer.id)).toMatchObject({ status: 'present', source: 'classes', sessions: 1, sessionsMarked: 1 });
    expect(row(idle.id)).toMatchObject({ status: null, source: 'no_classes' });
    expect((await trainer.client.get(`/admin/trainer-attendance?day=${classDay}`)).status).toBe(403);
    const future = istDay(Date.now() + 48 * H);
    expect(
      (
        await admin.client.send('put', '/admin/trainer-attendance', {
          trainerId: idle.id,
          day: future,
          status: 'leave',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.client.send('put', '/admin/trainer-attendance', {
          trainerId: idle.id,
          day: classDay,
          status: 'leave',
          note: 'Sick leave',
        })
      ).status,
    ).toBe(200);
    // changing an existing mark needs a reason
    expect(
      (
        await admin.client.send('put', '/admin/trainer-attendance', {
          trainerId: idle.id,
          day: classDay,
          status: 'absent',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.client.send('put', '/admin/trainer-attendance', {
          trainerId: idle.id,
          day: classDay,
          status: 'half_day',
          note: 'Came in after lunch',
        })
      ).status,
    ).toBe(200);
    const d2 = await admin.client.get(`/admin/trainer-attendance?day=${classDay}`);
    expect(row(idle.id, d2)).toMatchObject({ status: 'half_day', source: 'admin', note: 'Came in after lunch' });
    const sum = await admin.client.get('/admin/trainer-attendance/summary?days=7');
    expect(sum.body.trainers.find((t: { id: string }) => t.id === trainer.id)).toMatchObject({
      present: 1,
      presentFromClasses: 1,
    });
    expect(sum.body.trainers.find((t: { id: string }) => t.id === idle.id)).toMatchObject({ halfDay: 1, leave: 0 });
    expect(
      (
        await ctx.prisma.auditLog.findMany({
          where: { targetId: idle.id, action: { startsWith: 'admin.trainer_attendance' } },
        })
      )
        .map((x) => x.action)
        .sort(),
    ).toEqual(['admin.trainer_attendance.changed', 'admin.trainer_attendance.marked']);
  });
});
