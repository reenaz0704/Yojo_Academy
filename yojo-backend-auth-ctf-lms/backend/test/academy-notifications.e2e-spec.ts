import { MaintenanceJobs } from '../src/jobs/maintenance.jobs';
import { makeStaff, makeStudent, startApp, type StaffUser, type TestCtx } from './helpers';

/**
 * Slice (h): notifications come only from server events (booking and leave decisions, messages, blog decisions),
 * are private to their owner, are deduplicated, and important ones are emailed unless the student turned that off.
 * Admin broadcast is batch-scoped and audited. The Orbi assistant reports that no assistant service is connected.
 */
describe('Student Academy: notifications and the Orbi boundary', () => {
  let ctx: TestCtx;
  let admin: StaffUser, trainer: StaffUser;
  let st: Awaited<ReturnType<typeof makeStudent>>, mate: Awaited<ReturnType<typeof makeStudent>>;
  let batchId: string;
  const H = 3600_000;
  const bell = async (c: typeof st.client) => (await c.get('/me/notifications')).body;

  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    trainer = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    st = await makeStudent(ctx);
    mate = await makeStudent(ctx);
    const b = await admin.client.post('/admin/batches', {
      code: `NT-${Date.now().toString(36)}`,
      name: 'Notifications batch',
      trainerId: trainer.id,
      status: 'active',
    });
    batchId = b.body.id;
    for (const s of [st, mate]) await admin.client.post(`/admin/students/${s.id}/enrolments`, { batchId });
  });
  afterAll(async () => ctx.app.close());

  it('starts empty; a booking decision notifies only that student, once, and emails it', async () => {
    expect(await bell(st.client)).toEqual({ unread: 0, items: [] });
    const slot = await trainer.client.post('/trainer/slots', {
      startsAt: new Date(Date.now() + 30 * H).toISOString(),
      endsAt: new Date(Date.now() + 31 * H).toISOString(),
      kind: 'one_to_one',
    });
    const r = await st.client.post('/student/session-requests', { slotId: slot.body.id, purpose: 'doubt' });
    await trainer.client.post(`/trainer/session-requests/${r.body.id}/decide`, { decision: 'approve' });
    const b = await bell(st.client);
    expect(b.unread).toBe(1);
    expect(b.items[0]).toMatchObject({ kind: 'booking', title: 'Your session request was approved', important: true });
    expect(b.items[0].link).toBe('#/lms/trainer');
    expect((await bell(mate.client)).unread).toBe(0);
    await ctx.app.get(MaintenanceJobs).relayOutbox();
    const mail = ctx.mail.lastTo(st.email, 'academy_notification');
    expect(mail?.subject).toContain('approved');
    expect(mail?.text).toContain('/academy.html#/lms/trainer');
  });

  it('read, read-all and ownership', async () => {
    const id = (await bell(st.client)).items[0].id;
    expect((await mate.client.post(`/me/notifications/${id}/read`)).status).toBe(404);
    expect((await st.client.post(`/me/notifications/${id}/read`)).body).toEqual({ id, read: true });
    expect((await bell(st.client)).unread).toBe(0);
    expect((await st.client.get('/me/notifications?unread=true')).body.items).toEqual([]);
    expect((await st.client.post('/me/notifications/read-all')).body.marked).toBe(0);
  });

  it('leave and message notifications; email preference is respected', async () => {
    expect((await st.client.get('/me/notifications/preferences')).body.emailImportant).toBe(true);
    expect((await st.client.send('put', '/me/notifications/preferences', { emailImportant: false })).status).toBe(200);
    const day = new Date(Date.now() + 50 * H).toISOString().slice(0, 10);
    const l = await st.client.post('/student/leave-requests', { from: day, to: day, reason: 'Medical appointment' });
    await trainer.client.post(`/trainer/leave-requests/${l.body.id}/decide`, { approve: false, note: 'Exam day' });
    const c = await st.client.post('/student/conversations', {
      staffId: trainer.id,
      subject: 'Lab question',
      body: 'Which log source first?',
    });
    expect((await bell(trainer.client)).items[0]).toMatchObject({
      kind: 'message',
      title: 'New message: Lab question',
    });
    await trainer.client.post(`/trainer/conversations/${c.body.id}/messages`, { body: 'Start with auth logs.' });
    const b = await bell(st.client);
    expect(b.items.map((i: { kind: string }) => i.kind).slice(0, 2)).toEqual(['message', 'leave']);
    expect(b.items[1]).toMatchObject({ title: 'Your leave request was declined', body: 'Exam day' });

    // A second approved booking is important, but this student opted out of email.
    const before = ctx.mail.sent.filter((m) => m.to === st.email && m.template === 'academy_notification').length;
    const slot = await trainer.client.post('/trainer/slots', {
      startsAt: new Date(Date.now() + 40 * H).toISOString(),
      endsAt: new Date(Date.now() + 41 * H).toISOString(),
      kind: 'one_to_one',
    });
    const r = await st.client.post('/student/session-requests', { slotId: slot.body.id, purpose: 'doubt' });
    await trainer.client.post(`/trainer/session-requests/${r.body.id}/decide`, { decision: 'approve' });
    expect((await bell(st.client)).items[0].kind).toBe('booking');
    await ctx.app.get(MaintenanceJobs).relayOutbox();
    expect(ctx.mail.sent.filter((m) => m.to === st.email && m.template === 'academy_notification')).toHaveLength(
      before,
    );
  });

  it('blog decisions notify the author', async () => {
    const b = await mate.client.post('/student/blogs', {
      title: `Notes on phishing triage ${Date.now().toString(36)}`,
      body: 'Check the sender domain, the reply-to, the links and the attachment type before anything else. Then compare with known campaigns.',
    });
    await mate.client.post(`/student/blogs/${b.body.id}/submit`, { ownWork: true });
    await admin.client.post(`/admin/blogs/${b.body.id}/decision`, {
      decision: 'request_changes',
      note: 'Add an example header.',
    });
    expect((await bell(mate.client)).items[0]).toMatchObject({ kind: 'blog', body: 'Add an example header.' });
    expect((await bell(mate.client)).items[0].title).toMatch(/^Your blog needs changes/);
  });

  it('admin broadcast: one batch or all students, validated, permission-checked and audited', async () => {
    expect(
      (await admin.client.post('/admin/notifications/broadcast', { title: 'Hi', body: 'x', batchId })).status,
    ).toBe(400);
    expect(
      (await admin.client.post('/admin/notifications/broadcast', { title: 'Lab day moved', body: 'x' })).status,
    ).toBe(400);
    expect(
      (await trainer.client.post('/admin/notifications/broadcast', { title: 'Lab day moved', body: 'x', batchId }))
        .status,
    ).toBe(403);
    const ok = await admin.client.post('/admin/notifications/broadcast', {
      title: 'Lab day moved',
      body: 'Thursday labs move to Friday this week.',
      batchId,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.recipients).toBe(2);
    for (const s of [st, mate]) expect((await bell(s.client)).items[0]).toMatchObject({ kind: 'broadcast' });
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'admin.notification.broadcast', targetId: batchId } }),
    ).toBe(1);

    const students = await ctx.prisma.user.count({ where: { role: 'student', status: 'active' } });
    const all = await admin.client.post('/admin/notifications/broadcast', {
      title: 'Platform maintenance',
      body: 'Short pause on Sunday.',
      allStudents: true,
    });
    if (students > 200) expect(all.body.code).toBe('NEEDS_SECOND_ADMIN');
    else expect(all.body.recipients).toBe(students);
  });

  it('Orbi says honestly that no assistant is connected', async () => {
    expect((await st.client.get('/student/assistant')).body).toMatchObject({
      available: false,
      reason: 'ASSISTANT_NOT_CONFIGURED',
    });
    const r = await st.client.post('/student/assistant/messages', { message: 'What is a SIEM?' });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('ASSISTANT_NOT_CONFIGURED');
    expect((await trainer.client.get('/student/assistant')).status).toBe(403);
  });
});
