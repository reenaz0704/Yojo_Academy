import { makeStaff, makeStudent, startApp, type StaffUser, type TestCtx } from './helpers';

/**
 * Admin LMS → Analytics, Insight Engine (rule-based) and the certificate register: figures come from stored records,
 * every insight names its rule and the records behind it, and only admins with the permission can read them.
 */
describe('Admin LMS: analytics, rule-based insights, certificates', () => {
  let ctx: TestCtx;
  let admin: StaffUser, trainer: StaffUser;
  let st: Awaited<ReturnType<typeof makeStudent>>;
  let batchId = '',
    courseId = '',
    lessonId = '';
  const tag = Date.now().toString(36).toUpperCase();
  const H = 3600_000;
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    trainer = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    st = await makeStudent(ctx);
    const c = await admin.client.post('/admin/courses', {
      code: `AN-${tag}`,
      slug: `an-${tag.toLowerCase()}`,
      title: `Analytics course ${tag}`,
      category: 'Cybersecurity Fundamentals',
      access: 'free',
      summary: 'For analytics checks.',
      certificate: 'Yojo completion certificate',
    });
    courseId = c.body.id;
    const m = await admin.client.post(`/admin/courses/${courseId}/modules`, { title: 'Basics' });
    const l = await admin.client.post(`/admin/modules/${m.body.id}/lessons`, {
      title: 'Only lesson',
      type: 'concept',
      status: 'published',
      body: 'Plain text body.',
    });
    lessonId = l.body.id;
    await admin.client.post(`/admin/courses/${courseId}/status`, { status: 'published' });
    const b = await admin.client.post('/admin/batches', {
      code: `AN-${tag}`,
      name: 'Analytics batch',
      trainerId: trainer.id,
      courseId,
      status: 'active',
    });
    batchId = b.body.id;
    await admin.client.post(`/admin/students/${st.id}/enrolments`, { batchId });
    await st.client.post('/student/career-path', { path: 'GRC' });
    // one past session marked absent → below the attendance requirement
    const s = await trainer.client.post('/trainer/sessions', {
      batchId,
      type: 'class',
      title: 'Missed class',
      startsAt: iso(-30 * H),
      endsAt: iso(-29 * H),
    });
    await trainer.client.send('put', `/trainer/sessions/${s.body.id}/attendance`, {
      marks: [{ studentId: st.id, mark: 'absent' }],
    });
  });
  afterAll(async () => ctx.app.close());

  it('analytics: counts from records, with definitions', async () => {
    const r = await admin.client.get('/admin/lms/analytics');
    expect(r.status).toBe(200);
    expect(r.body.students.total).toBeGreaterThanOrEqual(1);
    expect(r.body.students.paid + r.body.students.free).toBe(r.body.students.total);
    expect(r.body.paths.GRC).toBeGreaterThanOrEqual(1);
    expect(r.body.careerQuiz.skipped).toBeGreaterThanOrEqual(1);
    const cohort = r.body.cohorts.find((x: { batch: string }) => x.batch === `AN-${tag}`);
    expect(cohort).toMatchObject({ students: 1, attendanceAvg: 0, flagged: 1 });
    expect(Object.keys(r.body.definitions)).toEqual(
      expect.arrayContaining(['students', 'paths', 'careerQuiz', 'activeLast7Days', 'assessments', 'labs', 'cohorts']),
    );
    expect((await trainer.client.get('/admin/lms/analytics')).status).toBe(403);
    expect((await st.client.get('/admin/lms/analytics')).status).toBe(403);
  });

  it('insights are fixed rules with their definition and the records that triggered them', async () => {
    const r = await admin.client.get('/admin/lms/insights');
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('rule-based');
    const low = r.body.insights.find((i: { id: string }) => i.id === 'low_attendance');
    expect(low.definition).toMatch(/Attendance under \d+%/);
    expect(low.items.some((x: { link: string }) => x.link === `#/admin/reports/${st.id}`)).toBe(true);
    for (const i of r.body.insights) expect(i.count).toBe(i.items.length > 25 ? i.count : i.items.length);
    expect((await trainer.client.get('/admin/lms/insights')).status).toBe(403);
  });

  it('certificate register: issue on eligibility, list, filter, revoke, public verify', async () => {
    expect((await admin.client.post('/admin/certificates', { userId: st.id, courseId })).status).toBe(409); // not complete
    await st.client.get(`/student/lessons/${lessonId}`);
    await st.client.post(`/student/lessons/${lessonId}/complete`);
    const c = await admin.client.post('/admin/certificates', { userId: st.id, courseId });
    expect(c.status).toBe(201);
    const list = await admin.client.get(`/admin/certificates?q=${encodeURIComponent(st.email)}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      code: c.body.code,
      courseId,
      student: { id: st.id, email: st.email },
      revokedAt: null,
    });
    expect((await admin.client.get(`/admin/certificates?q=${c.body.code}`)).body).toHaveLength(1);
    await admin.client.post(`/admin/certificates/${c.body.code}/revoke`, { reason: 'Issued by mistake in a test' });
    const revoked = await admin.client.get(`/admin/certificates?status=revoked&courseId=${courseId}`);
    expect(revoked.body.map((x: { code: string }) => x.code)).toEqual([c.body.code]);
    expect(revoked.body[0].revokeReason).toBe('Issued by mistake in a test');
    expect((await admin.client.get(`/certificates/${c.body.code}/verify`)).body.valid).toBe(false);
    expect((await trainer.client.get('/admin/certificates')).status).toBe(403);
  });
});
