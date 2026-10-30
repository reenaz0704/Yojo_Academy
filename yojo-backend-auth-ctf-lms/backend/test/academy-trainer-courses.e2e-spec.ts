import { makeStaff, startApp, type StaffUser, type TestCtx } from './helpers';

/**
 * Owner decision (24 Oct): trainers edit modules, lessons and FAQs of courses run by batches they lead or co-lead.
 * 29 Oct: owners and co-editors also publish (academy-trainer-course-builder.e2e-spec.ts); price and free/paid
 * stay admin-only. Every trainer edit is audited as trainer.course.*.
 */
describe('Trainer console: course content', () => {
  let ctx: TestCtx;
  let admin: StaffUser, trainer: StaffUser, coTrainer: StaffUser, other: StaffUser;
  const tag = Date.now().toString(36).toUpperCase();
  let mine = '',
    theirs = '';

  const course = async (code: string) => {
    const r = await admin.client.post('/admin/courses', {
      code: `TC-${code}-${tag}`,
      slug: `tc-${code.toLowerCase()}-${tag.toLowerCase()}`,
      title: `Trainer course ${code} ${tag}`,
      category: 'Defensive Security and SOC',
      access: 'paid',
      summary: 'Course for trainer edit checks.',
    });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };

  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    trainer = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    coTrainer = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    other = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    mine = await course('MINE');
    theirs = await course('THEIRS');
    const b = await admin.client.post('/admin/batches', {
      code: `TC-${tag}`,
      name: 'Trainer course batch',
      trainerId: trainer.id,
      coTrainerIds: [coTrainer.id],
      courseId: mine,
      status: 'active',
    });
    expect(b.status).toBe(201);
    await admin.client.post('/admin/batches', {
      code: `TC2-${tag}`,
      name: 'Other batch',
      trainerId: other.id,
      courseId: theirs,
      status: 'active',
    });
  });
  afterAll(async () => ctx.app.close());

  it('lists only courses of the trainer’s batches, without the price', async () => {
    const l = await trainer.client.get('/trainer/courses');
    expect(l.status).toBe(200);
    expect(l.body.items.map((c: { id: string }) => c.id)).toEqual([mine]);
    expect(l.body.items[0].myBatches).toEqual([`TC-${tag}`]);
    const d = await trainer.client.get(`/trainer/courses/${mine}`);
    expect(d.status).toBe(200);
    expect(d.body).not.toHaveProperty('pricePaise');
    expect((await trainer.client.get(`/trainer/courses/${theirs}`)).status).toBe(404);
    expect((await coTrainer.client.get('/trainer/courses')).body.items.map((c: { id: string }) => c.id)).toEqual([
      mine,
    ]);
  });

  it('own course: modules, lessons and FAQs can be created, edited and deleted, and each edit is audited', async () => {
    const m = await trainer.client.post(`/trainer/courses/${mine}/modules`, { title: 'Log sources', sortOrder: 1 });
    expect(m.status).toBe(201);
    // OI-48: an edit or delete needs a reason from the list; "other" needs a note
    const noReason = await trainer.client.send('patch', `/trainer/modules/${m.body.id}`, { title: 'Log sources 101' });
    expect(noReason.status).toBe(400);
    const otherNoNote = await trainer.client.send('patch', `/trainer/modules/${m.body.id}`, {
      title: 'Log sources 101',
      reasonCode: 'other',
    });
    expect(otherNoNote.status).toBe(400);
    expect((await trainer.client.send('delete', `/trainer/modules/${m.body.id}`)).status).toBe(400);
    expect(
      (
        await trainer.client.send('patch', `/trainer/modules/${m.body.id}`, {
          title: 'Log sources 101',
          reasonCode: 'restructure',
          reasonNote: 'Split from the SIEM module',
        })
      ).status,
    ).toBe(200);
    expect((await ctx.prisma.courseModule.findUniqueOrThrow({ where: { id: m.body.id } })).title).toBe(
      'Log sources 101',
    );
    const l = await coTrainer.client.post(`/trainer/modules/${m.body.id}/lessons`, {
      title: 'Windows event logs',
      type: 'concept',
      status: 'published',
      body: 'Event ID 4625 is a failed logon.',
    });
    expect(l.status).toBe(201);
    expect(
      (
        await trainer.client.send('patch', `/trainer/lessons/${l.body.id}`, {
          title: 'Windows logs',
          reasonCode: 'outdated',
        })
      ).status,
    ).toBe(200);
    const f = await trainer.client.post(`/trainer/courses/${mine}/faqs`, {
      question: 'Is there a lab?',
      answer: 'Yes.',
    });
    expect(f.status).toBe(201);
    expect(
      (
        await trainer.client.send('patch', `/trainer/faqs/${f.body.id}`, {
          published: true,
          ...{ reasonCode: 'content_correction' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await trainer.client.send('delete', `/trainer/faqs/${f.body.id}`, {
          reasonCode: 'other',
          reasonNote: 'Answered in the course page now',
        })
      ).status,
    ).toBe(204);
    expect(
      (await trainer.client.send('delete', `/trainer/lessons/${l.body.id}`, { reasonCode: 'duplicate' })).status,
    ).toBe(204);
    expect(
      (await trainer.client.send('delete', `/trainer/modules/${m.body.id}`, { reasonCode: 'restructure' })).status,
    ).toBe(204);
    const log = await ctx.prisma.auditLog.findMany({
      where: { targetId: mine, actorRole: 'trainer' },
      select: { action: true, actorId: true },
    });
    expect(log.map((x) => x.action).sort()).toEqual(
      [
        'trainer.course.faq_added',
        'trainer.course.faq_deleted',
        'trainer.course.faq_updated',
        'trainer.course.lesson_added',
        'trainer.course.lesson_deleted',
        'trainer.course.lesson_updated',
        'trainer.course.module_added',
        'trainer.course.module_deleted',
        'trainer.course.module_updated',
      ].sort(),
    );
    expect(log.find((x) => x.action === 'trainer.course.lesson_added')!.actorId).toBe(coTrainer.id);
    // admins see each change with its reason
    const ch = await admin.client.get(`/admin/courses/${mine}/changes`);
    expect(ch.status).toBe(200);
    const faqDel = ch.body.items.find((x: { action: string }) => x.action === 'faq_deleted');
    expect(faqDel).toMatchObject({
      reasonCode: 'other',
      reasonLabel: 'Other',
      reasonNote: 'Answered in the course page now',
      target: 'faq',
    });
    expect(ch.body.items.find((x: { action: string }) => x.action === 'module_updated')).toMatchObject({
      reasonLabel: 'Restructuring the course',
      reasonNote: 'Split from the SIEM module',
    });
    expect(ch.body.items.find((x: { action: string }) => x.action === 'lesson_added').reasonCode).toBeNull();
    expect((await trainer.client.get(`/admin/courses/${mine}/changes`)).status).toBe(403);
    const row = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { targetId: mine, action: 'trainer.course.lesson_deleted' },
    });
    expect(row.reason).toBe('Duplicate');
  });

  it('another trainer’s course answers 404 for every content route', async () => {
    const m = await admin.client.post(`/admin/courses/${theirs}/modules`, { title: 'Admin module' });
    const l = await admin.client.post(`/admin/modules/${m.body.id}/lessons`, {
      title: 'Admin lesson',
      type: 'concept',
      body: 'Plain text body.',
    });
    expect(l.status).toBe(201);
    const f = await admin.client.post(`/admin/courses/${theirs}/faqs`, {
      question: 'Is there a lab?',
      answer: 'Yes, a SIEM lab.',
    });
    expect(f.status).toBe(201);
    const c = trainer.client;
    expect((await c.post(`/trainer/courses/${theirs}/modules`, { title: 'Hijack' })).status).toBe(404);
    expect(
      (
        await c.send('patch', `/trainer/modules/${m.body.id}`, {
          title: 'Hijack',
          ...{ reasonCode: 'content_correction' },
        })
      ).status,
    ).toBe(404);
    expect((await c.send('delete', `/trainer/modules/${m.body.id}`, { reasonCode: 'content_correction' })).status).toBe(
      404,
    );
    expect(
      (await c.post(`/trainer/modules/${m.body.id}/lessons`, { title: 'Hijack', type: 'concept', body: 'x' })).status,
    ).toBe(404);
    expect(
      (
        await c.send('patch', `/trainer/lessons/${l.body.id}`, {
          title: 'Hijack',
          ...{ reasonCode: 'content_correction' },
        })
      ).status,
    ).toBe(404);
    expect((await c.send('delete', `/trainer/lessons/${l.body.id}`, { reasonCode: 'content_correction' })).status).toBe(
      404,
    );
    expect(
      (await c.post(`/trainer/courses/${theirs}/faqs`, { question: 'Hijack this FAQ?', answer: 'A valid answer.' }))
        .status,
    ).toBe(404);
    expect(
      (
        await c.send('patch', `/trainer/faqs/${f.body.id}`, {
          answer: 'Hijacked answer.',
          ...{ reasonCode: 'content_correction' },
        })
      ).status,
    ).toBe(404);
    expect((await c.send('delete', `/trainer/faqs/${f.body.id}`, { reasonCode: 'content_correction' })).status).toBe(
      404,
    );
    expect((await ctx.prisma.courseModule.findUniqueOrThrow({ where: { id: m.body.id } })).title).toBe('Admin module');
  });

  it('a trainer who only runs the course cannot publish or edit its details; price and free/paid stay admin-only', async () => {
    const c = trainer.client;
    expect((await c.post(`/admin/courses/${mine}/status`, { status: 'published' })).status).toBe(403);
    expect((await c.send('patch', `/admin/courses/${mine}`, { pricePaise: 100, access: 'free' })).status).toBe(403);
    // owner decision (29 Oct): only the course owner and co-editors publish; this course is owned by an admin
    expect((await c.post(`/trainer/courses/${mine}/publish`)).body.code).toBe('NOT_COURSE_EDITOR');
    expect((await c.send('patch', `/trainer/courses/${mine}`, { title: 'Renamed' })).body.code).toBe(
      'NOT_COURSE_EDITOR',
    );
    expect((await c.send('patch', `/trainer/courses/${mine}`, { pricePaise: 100 })).status).toBe(400);
    expect((await c.send('patch', `/trainer/courses/${mine}`, { access: 'free' })).status).toBe(400);
    const cur = await ctx.prisma.course.findUniqueOrThrow({ where: { id: mine } });
    expect(cur).toMatchObject({ status: 'draft', access: 'paid' });
    expect((await other.client.get(`/trainer/courses/${mine}`)).status).toBe(404);
  });
});
