import { GamificationService } from '../src/academy/gamification.service';
import { Client, makeStaff, makeStudent, startApp, type StaffUser, type TestCtx } from './helpers';

/**
 * Slice (b): catalog visibility, access rule and pending reasons, lesson content and completion rules, progress,
 * certificates, and admin authorisation. Paid access is granted with an entitlement row directly (the API route
 * for it needs a fresh MFA step-up and has its own tests in journeys.e2e-spec.ts).
 */
describe('Student Academy: courses, lessons, progress, certificates', () => {
  let ctx: TestCtx;
  let admin: StaffUser;
  let game: GamificationService;
  const tag = Date.now().toString(36).toUpperCase().slice(-6);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await startApp();
    game = ctx.app.get(GamificationService);
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    const a = admin.client;
    const paid = await a.post('/admin/courses', {
      code: `T-SOC-${tag}`,
      slug: `t-soc-${tag.toLowerCase()}`,
      title: `Test SOC Analyst ${tag}`,
      category: 'Defensive Security and SOC',
      access: 'paid',
      level: 'Intermediate',
      summary: 'Monitor, detect and respond.',
      certificate: 'Yojo completion certificate',
      labs: ['SIEM sandbox'],
    });
    expect(paid.status).toBe(201);
    ids.paid = paid.body.id;
    const m = await a.post(`/admin/courses/${ids.paid}/modules`, { title: 'Module 1', sortOrder: 1 });
    ids.module = m.body.id;
    const l1 = await a.post(`/admin/modules/${ids.module}/lessons`, {
      title: 'SIEM fundamentals',
      type: 'video',
      status: 'published',
      preview: true,
      contentUrl: 'https://videos.example.invalid/siem',
      sortOrder: 1,
    });
    ids.l1 = l1.body.id;
    const l2 = await a.post(`/admin/modules/${ids.module}/lessons`, {
      title: 'Quiz 1',
      type: 'quiz',
      status: 'published',
      completion: 'quiz_pass',
      refCode: `Q-${tag}`,
      sortOrder: 2,
    });
    ids.l2 = l2.body.id;
    await a.post(`/admin/modules/${ids.module}/lessons`, {
      title: 'Draft lesson',
      type: 'concept',
      body: 'secret draft',
      sortOrder: 3,
    });
    await a.post(`/admin/courses/${ids.paid}/faqs`, { question: 'Is there a lab?', answer: 'Yes.', published: true });
    await a.post(`/admin/courses/${ids.paid}/faqs`, {
      question: 'Internal pricing note?',
      answer: 'Hidden.',
      published: false,
    });
    expect((await a.post(`/admin/courses/${ids.paid}/status`, { status: 'published' })).status).toBe(200);

    const free = await a.post('/admin/courses', {
      code: `T-FND-${tag}`,
      slug: `t-fnd-${tag.toLowerCase()}`,
      title: `Test Foundations ${tag}`,
      category: 'Cybersecurity Fundamentals',
      access: 'free',
      level: 'Beginner',
      summary: 'Start here.',
    });
    ids.free = free.body.id;
    const fm = await a.post(`/admin/courses/${ids.free}/modules`, { title: 'Basics' });
    const fl = await a.post(`/admin/modules/${fm.body.id}/lessons`, {
      title: 'What is security?',
      type: 'concept',
      status: 'published',
      body: 'Plain text body.',
    });
    ids.fl = fl.body.id;
    await a.post(`/admin/courses/${ids.free}/status`, { status: 'published' });

    const draft = await a.post('/admin/courses', {
      code: `T-DR-${tag}`,
      slug: `t-dr-${tag.toLowerCase()}`,
      title: 'Draft course',
      category: 'GRC',
      summary: 'x',
    });
    ids.draft = draft.body.id;
  });
  afterAll(async () => ctx.app.close());

  it('public catalog: published only, public fields only, unpublished FAQ and draft lessons hidden', async () => {
    const v = await new Client(ctx.server).init();
    const cat = await v.get(`/courses?q=${tag}&limit=50`);
    expect(cat.status).toBe(200);
    const slugs = cat.body.items.map((c: { slug: string }) => c.slug);
    expect(slugs).toEqual(expect.arrayContaining([`t-soc-${tag.toLowerCase()}`, `t-fnd-${tag.toLowerCase()}`]));
    expect(slugs).not.toContain(`t-dr-${tag.toLowerCase()}`);
    const d = await v.get(`/courses/t-soc-${tag.toLowerCase()}`);
    expect(d.body.faqs).toEqual([{ question: 'Is there a lab?', answer: 'Yes.' }]);
    expect(d.body.lessonCount).toBe(2);
    expect(JSON.stringify(d.body)).not.toMatch(/videos\.example|secret draft|refCode|contentUrl|ownerId/);
    expect((await v.get(`/courses/t-dr-${tag.toLowerCase()}`)).status).toBe(404);
    const freeOnly = await v.get(`/courses?filter=free&q=${tag}`);
    expect(freeOnly.body.items.every((c: { access: string }) => c.access === 'free')).toBe(true);
    const recent = await v.get(`/courses?filter=recent&q=${tag}`);
    expect(recent.body.total).toBe(2);
    expect((await v.get('/courses/categories')).body.length).toBeGreaterThan(0);
  });

  it('free course: open to any student; completion needs the lesson opened first; it feeds the daily patch', async () => {
    const st = await makeStudent(ctx);
    const early = await st.client.post(`/student/lessons/${ids.fl}/complete`);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('OPEN_FIRST');
    const open = await st.client.get(`/student/lessons/${ids.fl}`);
    expect(open.status).toBe(200);
    expect(open.body.body).toBe('Plain text body.');
    const done = await st.client.post(`/student/lessons/${ids.fl}/complete`);
    expect(done.body).toMatchObject({ completed: true, course: { pct: 100, complete: true } });
    const claim = await st.client.post('/student/daily/learn/claim');
    expect(claim.status).toBe(200);
  });

  it('paid course: pending reasons in order (payment → batch → approval), then enrolled through a batch', async () => {
    const st = await makeStudent(ctx);
    const slug = `t-soc-${tag.toLowerCase()}`;
    const d1 = await st.client.get(`/student/courses/${slug}`);
    expect(d1.body).toMatchObject({ state: 'locked', pendingReason: 'payment' });
    expect((await st.client.get(`/student/lessons/${ids.l2}`)).status).toBe(403);
    expect((await st.client.get(`/student/lessons/${ids.l1}`)).status).toBe(200); // preview lesson
    expect((await st.client.post(`/student/lessons/${ids.l1}/complete`)).status).toBe(403);

    await ctx.prisma.entitlement.create({
      data: { studentId: st.id, key: 'plan:paid', source: 'manual', reason: 'test paid access' },
    });
    expect((await st.client.get(`/student/courses/${slug}`)).body.pendingReason).toBe('batch_assignment');
    await st.client.post('/public/submissions', { type: 'course_enrolment', topic: `Test SOC Analyst ${tag}` });
    expect((await st.client.get(`/student/courses/${slug}`)).body.pendingReason).toBe('approval');
    const pending = await st.client.get('/student/courses?view=pending');
    expect(pending.body.items.map((c: { slug: string }) => c.slug)).toContain(slug);

    const b = await admin.client.post('/admin/batches', {
      code: `TB-${tag}-${st.id.slice(0, 4)}`,
      name: 'Test batch',
      courseId: ids.paid,
      status: 'active',
    });
    expect(b.status).toBe(201);
    expect((await admin.client.post(`/admin/students/${st.id}/enrolments`, { batchId: b.body.id })).status).toBe(201);
    const d2 = await st.client.get(`/student/courses/${slug}`);
    expect(d2.body).toMatchObject({ state: 'enrolled', pendingReason: null });
    const mine = await st.client.get('/student/courses?view=mine');
    expect(mine.body.items.map((c: { slug: string }) => c.slug)).toContain(slug);

    // quiz lesson needs the verified quiz result
    await st.client.get(`/student/lessons/${ids.l2}`);
    const q = await st.client.post(`/student/lessons/${ids.l2}/complete`);
    expect(q.status).toBe(409);
    expect(q.body.code).toBe('NEEDS_VERIFIED_RESULT');
    await game.recordActivity(st.id, 'quiz_passed', `Q-${tag}`);
    await st.client.get(`/student/lessons/${ids.l1}`);
    await st.client.post(`/student/lessons/${ids.l1}/complete`);
    const fin = await st.client.post(`/student/lessons/${ids.l2}/complete`);
    expect(fin.body.course).toMatchObject({ complete: true, pct: 100, pendingModules: [] });
    expect((await st.client.get('/student/dashboard')).body.tiles.campaignsWon).toBe(1);

    // certificate: issued by an admin once, verifiable, revocable
    const c = await admin.client.post('/admin/certificates', { userId: st.id, courseId: ids.paid });
    expect(c.status).toBe(201);
    expect(c.body.code).toMatch(/^YJ-CERT-\d+$/);
    expect((await admin.client.post('/admin/certificates', { userId: st.id, courseId: ids.paid })).status).toBe(409);
    const v = await new Client(ctx.server).init();
    expect((await v.get(`/certificates/${c.body.code}/verify`)).body).toMatchObject({
      valid: true,
      holder: 'Test Student',
    });
    expect(
      (await admin.client.post(`/admin/certificates/${c.body.code}/revoke`, { reason: 'Issued in error' })).status,
    ).toBe(200);
    expect((await v.get(`/certificates/${c.body.code}/verify`)).body.valid).toBe(false);
    expect((await st.client.get('/student/certificates')).body).toHaveLength(1);

    // a lesson with progress cannot be deleted
    expect((await admin.client.send('delete', `/admin/lessons/${ids.l1}`)).status).toBe(409);
  });

  it('certificate refused while the course is incomplete; trending counts real enrolments', async () => {
    const st = await makeStudent(ctx);
    const r = await admin.client.post('/admin/certificates', { userId: st.id, courseId: ids.paid });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('NOT_ELIGIBLE');
    const t = await (await new Client(ctx.server).init()).get(`/courses?filter=trending&q=${tag}`);
    expect(t.body.items.map((c: { slug: string }) => c.slug)).toEqual([`t-soc-${tag.toLowerCase()}`]);
  });

  it('prerequisite blocks first', async () => {
    const b = await admin.client.post('/admin/courses', {
      code: `T-ADV-${tag}`,
      slug: `t-adv-${tag.toLowerCase()}`,
      title: `Advanced ${tag}`,
      category: 'Defensive Security and SOC',
      summary: 'x',
      prerequisiteCourseId: ids.free,
    });
    await admin.client.post(`/admin/courses/${b.body.id}/status`, { status: 'published' });
    const st = await makeStudent(ctx);
    expect((await st.client.get(`/student/courses/t-adv-${tag.toLowerCase()}`)).body.pendingReason).toBe(
      'prerequisite',
    );
  });

  it('course admin is for admins only; students and trainers are refused', async () => {
    const st = await makeStudent(ctx);
    const t = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    for (const c of [st.client, t.client]) {
      expect((await c.get('/admin/courses')).status).toBe(403);
      expect((await c.post('/admin/courses', { code: 'X-1', slug: 'x-1', title: 'Hack', category: 'x' })).status).toBe(
        403,
      );
      expect((await c.post('/admin/certificates', { userId: st.id, courseId: ids.paid })).status).toBe(403);
    }
    expect(
      (
        await admin.client.post('/admin/courses', {
          code: `T-SOC-${tag}`,
          slug: 'other-dup',
          title: 'Dup',
          category: 'GRC',
        })
      ).status,
    ).toBe(409);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'admin.course.published', targetId: ids.paid } })).toBe(
      1,
    );
  });
});
