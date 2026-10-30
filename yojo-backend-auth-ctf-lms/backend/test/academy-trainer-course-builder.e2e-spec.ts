import { makeStaff, makeStudent, startApp, type StaffUser, type TestCtx } from './helpers';

/**
 * Owner decisions (29 Oct): trainers create courses (they own them), add co-editors, assign their own batches and
 * publish their own courses. Once published, a trainer's edit or delete becomes a change request with a reason
 * (OI-48); the live course is unchanged until a Platform Admin approves (applied, version + 1) or rejects with a note.
 * Price and free/paid access stay admin-only.
 */
describe('Trainer console: course builder and change approval', () => {
  let ctx: TestCtx;
  let admin: StaffUser, a: StaffUser, b: StaffUser;
  let st: Awaited<ReturnType<typeof makeStudent>>;
  const tag = Date.now().toString(36).toUpperCase();
  let batchA = '',
    batchA2 = '',
    batchB = '',
    course = '',
    moduleId = '',
    lessonId = '';

  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    a = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    b = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    st = await makeStudent(ctx);
    const mk = async (code: string, trainerId: string) => {
      const r = await admin.client.post('/admin/batches', { code, name: code, trainerId, status: 'active' });
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    batchA = await mk(`CB-A-${tag}`, a.id);
    batchA2 = await mk(`CB-A2-${tag}`, a.id);
    batchB = await mk(`CB-B-${tag}`, b.id);
    await admin.client.post(`/admin/students/${st.id}/enrolments`, { batchId: batchA });
  });
  afterAll(async () => ctx.app.close());

  it('a trainer creates a draft course they own, on their own batches only', async () => {
    const body = {
      title: `Threat Hunting ${tag}`,
      track: 'Defensive',
      level: 'Intermediate',
      duration: '4 weeks',
      summary: 'Hunt for attackers in logs.',
      outcomes: ['Write a hunt hypothesis', 'Query Sysmon logs'],
    };
    expect((await a.client.post('/trainer/courses', { ...body, batchIds: [batchB] })).status).toBe(404);
    expect((await a.client.post('/trainer/courses', { ...body, pricePaise: 100 })).status).toBe(400);
    expect((await a.client.post('/trainer/courses', { ...body, access: 'free' })).status).toBe(400);
    const r = await a.client.post('/trainer/courses', { ...body, batchIds: [batchA] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'draft' });
    course = r.body.id;
    const c = await ctx.prisma.course.findUniqueOrThrow({ where: { id: course } });
    expect(c).toMatchObject({
      ownerId: a.id,
      category: 'Defensive Security and SOC',
      level: 'Intermediate',
      access: 'paid',
      pricePaise: null,
    });
    const l = await a.client.get('/trainer/courses');
    const it = l.body.items.find((x: { id: string }) => x.id === course);
    expect(it).toMatchObject({
      role: 'owner',
      owner: 'You',
      track: 'Defensive',
      enrolled: 1,
      batches: [`CB-A-${tag}`],
    });
    expect(l.body.counts.draft).toBeGreaterThanOrEqual(1);
    // a batch that already runs another course cannot be taken over
    const other = await a.client.post('/trainer/courses', { title: `Other ${tag}`, track: 'GRC', batchIds: [batchA] });
    expect(other.body.code).toBe('BATCH_HAS_COURSE');
    expect((await a.client.get('/trainer/course-batches')).body.map((x: { code: string }) => x.code)).toEqual(
      expect.arrayContaining([`CB-A-${tag}`, `CB-A2-${tag}`]),
    );
  });

  it('another trainer cannot see, edit or publish it; co-editors are added by the owner only', async () => {
    expect((await b.client.get(`/trainer/courses/${course}`)).status).toBe(404);
    expect((await b.client.get('/trainer/courses')).body.items.some((x: { id: string }) => x.id === course)).toBe(
      false,
    );
    expect((await b.client.post(`/trainer/courses/${course}/publish`)).status).toBe(404);
    expect((await b.client.send('patch', `/trainer/courses/${course}`, { title: 'Hijack' })).status).toBe(404);
    expect((await b.client.get(`/trainer/courses/${course}/students`)).status).toBe(404);
    expect((await a.client.post(`/trainer/courses/${course}/batches`, { batchIds: [batchB] })).status).toBe(404);
    expect((await a.client.post(`/trainer/courses/${course}/co-editors`, { email: b.email })).status).toBe(201);
    const g = await b.client.get(`/trainer/courses/${course}`);
    expect(g.status).toBe(200);
    expect(g.body.role).toBe('co_editor');
    expect(g.body).not.toHaveProperty('pricePaise');
    expect((await b.client.post(`/trainer/courses/${course}/co-editors`, { email: a.email })).body.code).toBe(
      'NOT_COURSE_OWNER',
    );
  });

  it('drafts are edited directly; publishing needs content', async () => {
    const p = await b.client.send('patch', `/trainer/courses/${course}`, { duration: '5 weeks' });
    expect(p.status).toBe(200);
    expect((await ctx.prisma.course.findUniqueOrThrow({ where: { id: course } })).duration).toBe('5 weeks');
    expect((await a.client.send('patch', `/trainer/courses/${course}`, { pricePaise: 5 })).status).toBe(400);
    const m = await a.client.post(`/trainer/courses/${course}/modules`, { title: 'Hypotheses' });
    expect(m.status).toBe(201);
    moduleId = m.body.id;
    await ctx.prisma.course.update({ where: { id: course }, data: { summary: '' } });
    expect((await a.client.post(`/trainer/courses/${course}/publish`)).body.code).toBe('NOT_PUBLISHABLE');
    const l = await a.client.post(`/trainer/modules/${moduleId}/lessons`, {
      title: 'What a hunt is',
      type: 'concept',
      status: 'published',
      body: 'A hunt starts from a hypothesis.',
    });
    expect(l.status).toBe(201);
    lessonId = l.body.id;
    const pub = await a.client.post(`/trainer/courses/${course}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('published');
    expect(
      await ctx.prisma.notification.count({
        where: { userId: st.id, dedupeKey: { startsWith: `course_published:${course}` } },
      }),
    ).toBe(1);
    expect((await a.client.post(`/trainer/courses/${course}/publish`)).body.code).toBe('ALREADY_PUBLISHED');
  });

  it('published: every trainer edit or delete waits for a Platform Admin and needs a reason', async () => {
    const before = await ctx.prisma.course.findUniqueOrThrow({ where: { id: course } });
    expect((await a.client.send('patch', `/trainer/courses/${course}`, { title: 'New title' })).status).toBe(400);
    const t = await a.client.send('patch', `/trainer/courses/${course}`, {
      title: `Threat Hunting 2 ${tag}`,
      reasonCode: 'content_correction',
    });
    expect(t.status).toBe(202);
    expect(t.body).toMatchObject({ pending: true, code: expect.stringMatching(/^CCR-\d+$/) });
    expect(
      (await a.client.post(`/trainer/modules/${moduleId}/lessons`, { title: 'X', type: 'concept', body: 'x' })).status,
    ).toBe(400);
    const add = await b.client.post(`/trainer/modules/${moduleId}/lessons`, {
      title: 'Sysmon basics',
      type: 'concept',
      status: 'published',
      body: 'Event ID 1 is process creation.',
      reasonCode: 'restructure',
    });
    expect(add.status).toBe(202);
    const del = await a.client.send('delete', `/trainer/lessons/${lessonId}`, {
      reasonCode: 'other',
      reasonNote: 'Merged into Sysmon basics',
    });
    expect(del.status).toBe(202);
    expect(del.body.pending).toBe(true);
    // the live course is unchanged
    const now = await ctx.prisma.course.findUniqueOrThrow({ where: { id: course }, include: { lessons: true } });
    expect(now.title).toBe(before.title);
    expect(now.version).toBe(before.version);
    expect(now.lessons.map((l) => l.id)).toEqual([lessonId]);
    expect((await a.client.get(`/trainer/courses/${course}`)).body.changeRequests).toHaveLength(3);
    expect(
      (await a.client.get('/trainer/courses')).body.items.find((x: { id: string }) => x.id === course).pendingChanges,
    ).toBe(3);
    expect(
      await ctx.prisma.auditLog.count({ where: { targetId: course, action: 'trainer.course.change_requested' } }),
    ).toBe(3);
  });

  it('admins approve (applied, version + 1) or reject with a note; trainers cannot decide', async () => {
    expect((await a.client.get('/admin/course-changes')).status).toBe(403);
    const q = await admin.client.get('/admin/course-changes');
    expect(q.status).toBe(200);
    const mine = q.body.items.filter((x: { course: { id: string } }) => x.course.id === course);
    expect(mine.map((x: { kind: string }) => x.kind)).toEqual(['course.patch', 'lesson.add', 'lesson.delete']);
    expect(mine[2]).toMatchObject({
      reasonLabel: 'Other',
      reasonNote: 'Merged into Sysmon basics',
      kindLabel: 'Delete a lesson',
    });
    const [title, add, del] = mine as { id: string; code: string }[];
    expect((await a.client.post(`/admin/course-changes/${title.id}/decide`, { approve: true })).status).toBe(403);
    const v0 = (await ctx.prisma.course.findUniqueOrThrow({ where: { id: course } })).version;
    const ok = await admin.client.post(`/admin/course-changes/${title.id}/decide`, { approve: true });
    expect(ok.status).toBe(200);
    const c1 = await ctx.prisma.course.findUniqueOrThrow({ where: { id: course } });
    expect(c1.title).toBe(`Threat Hunting 2 ${tag}`);
    expect(c1.version).toBe(v0 + 1);
    expect((await admin.client.post(`/admin/course-changes/${title.id}/decide`, { approve: true })).body.code).toBe(
      'ALREADY_DECIDED',
    );
    expect((await admin.client.post(`/admin/course-changes/${add.id}/decide`, { approve: false })).status).toBe(400);
    const no = await admin.client.post(`/admin/course-changes/${add.id}/decide`, {
      approve: false,
      note: 'Please add a lab link first.',
    });
    expect(no.body.status).toBe('rejected');
    expect(await ctx.prisma.lesson.count({ where: { courseId: course } })).toBe(1);
    expect(
      await ctx.prisma.notification.count({ where: { userId: b.id, dedupeKey: `course_change_decided:${add.id}` } }),
    ).toBe(1);
    await admin.client.post(`/admin/course-changes/${del.id}/decide`, { approve: true });
    expect(await ctx.prisma.lesson.count({ where: { id: lessonId } })).toBe(0);
    expect(
      (
        await ctx.prisma.auditLog.findMany({
          where: { targetId: course, action: { startsWith: 'admin.course.change_' } },
        })
      )
        .map((x) => x.action)
        .sort(),
    ).toEqual(['admin.course.change_approved', 'admin.course.change_approved', 'admin.course.change_rejected']);
  });

  it('unpublishing is a change request too; students of the trainer’s batches are listed', async () => {
    const s = await a.client.get(`/trainer/courses/${course}/students`);
    expect(s.status).toBe(200);
    expect(s.body.rows.map((r: { id: string }) => r.id)).toEqual([st.id]);
    expect(s.body.rows[0]).not.toHaveProperty('email');
    const u = await a.client.post(`/trainer/courses/${course}/unpublish`, { reasonCode: 'outdated' });
    expect(u.status).toBe(202);
    expect((await ctx.prisma.course.findUniqueOrThrow({ where: { id: course } })).status).toBe('published');
    await admin.client.post(`/admin/course-changes/${u.body.requestId}/decide`, { approve: true });
    expect((await ctx.prisma.course.findUniqueOrThrow({ where: { id: course } })).status).toBe('unpublished');
    // unpublished again: edits apply directly
    expect((await a.client.send('patch', `/trainer/courses/${course}`, { level: 'Advanced' })).status).toBe(200);
    expect((await a.client.post(`/trainer/courses/${course}/batches`, { batchIds: [batchA2] })).status).toBe(200);
    expect((await a.client.send('delete', `/trainer/courses/${course}/batches/${batchA2}`)).status).toBe(204);
    expect(await ctx.prisma.auditLog.count({ where: { targetId: course, action: 'trainer.course.created' } })).toBe(1);
  });
});
