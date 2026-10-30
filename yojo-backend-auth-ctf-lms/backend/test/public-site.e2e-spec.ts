// Team alert address for this file only (read when the app starts).
process.env.ENQUIRY_NOTIFY_EMAIL = 'enquiries-team@yojosolutions.com';

import { MaintenanceJobs } from '../src/jobs/maintenance.jobs';
import { Client, linkToken, makeStaff, makeStudent, startApp, uniq, type StaffUser, type TestCtx } from './helpers';

/**
 * Public website backend (docs/PUBLIC-INVENTORY.md): every form type end to end into the Admin LMS inbox, abuse
 * controls, authorisation, lifecycle rules, metrics, event reminders with unsubscribe, and managed content.
 */
describe('Public website: forms, Enquiries inbox, reminders, content', () => {
  let ctx: TestCtx;
  let admin: StaffUser;
  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
  });
  afterAll(async () => ctx.app.close());

  const visitor = () => new Client(ctx.server).init();
  const forms = {
    contact: (email: string) => ({
      type: 'contact',
      name: 'Sai Teja',
      phone: '+91 98765 00002',
      email,
      topic: 'Course and batch details',
      message: 'Batch timings?',
      consent: true,
      sourcePage: 'index.html#contact',
    }),
    mentorship_session: (email: string) => ({
      type: 'mentorship_session',
      name: 'Ananya Rao',
      phone: '+91 98765 00001',
      email,
      topic: 'Defensive security (SOC)',
      preferredAt: new Date(Date.now() + 3 * 86400_000).toISOString(),
      consent: true,
    }),
    internship_application: (email: string) => ({
      type: 'internship_application',
      name: 'Karthik Varma',
      email,
      topic: 'SOC detection engineering',
      message: 'I want to build detections.',
      consent: true,
    }),
  } as const;

  describe.each(Object.keys(forms) as (keyof typeof forms)[])('%s form, end to end', (type) => {
    it('submit → stored → reference → in the inbox → assign → status → note → contact attempt → history and audit', async () => {
      const email = uniq(type, 'example.com');
      const res = await (await visitor()).post('/public/submissions', forms[type](email));
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        reference: expect.stringMatching(/^ENQ-\d+$/),
        status: 'new',
        receivedAt: expect.any(String),
        duplicate: false,
      });
      const ref = res.body.reference as string;
      // The public answer never carries internal fields.
      expect(Object.keys(res.body).sort()).toEqual(['duplicate', 'receivedAt', 'reference', 'status']);

      const row = await ctx.prisma.publicSubmission.findUniqueOrThrow({ where: { reference: ref } });
      expect(row).toMatchObject({ type, email, status: 'new', consentKind: 'contact', userId: null });
      expect(row.consentVersion).toBeTruthy();

      const list = await admin.client.get(`/admin/submissions?q=${ref}`);
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({ reference: ref, type, status: 'new', assignee: null });

      const id = row.id;
      const a = await admin.client.post(`/admin/submissions/${id}/assign`, { assigneeId: admin.id });
      expect(a.body).toMatchObject({ status: 'assigned', assigneeId: admin.id });
      expect(
        (await admin.client.post(`/admin/submissions/${id}/status`, { from: 'assigned', status: 'in_progress' }))
          .status,
      ).toBe(200);
      expect(
        (await admin.client.post(`/admin/submissions/${id}/notes`, { body: 'Called, asked for CV.' })).status,
      ).toBe(201);
      expect(
        (await admin.client.post(`/admin/submissions/${id}/contact-attempts`, { channel: 'phone', outcome: 'reached' }))
          .status,
      ).toBe(201);
      const done = await admin.client.post(`/admin/submissions/${id}/status`, {
        from: 'in_progress',
        status: 'resolved',
        reason: 'Shared batch timings by phone.',
      });
      expect(done.body).toMatchObject({ status: 'resolved' });

      const d = await admin.client.get(`/admin/submissions/${id}`);
      expect(d.status).toBe(200);
      expect(d.body.notes.map((n: { body: string }) => n.body)).toEqual(['Called, asked for CV.']);
      expect(d.body.history.map((h: { kind: string }) => h.kind)).toEqual([
        'created',
        'assigned',
        'status',
        'note',
        'contact_attempt',
        'status',
      ]);
      expect(d.body.resolvedAt).toBeTruthy();

      const actions = (await ctx.prisma.auditLog.findMany({ where: { targetId: id }, select: { action: true } })).map(
        (x) => x.action,
      );
      expect(actions).toEqual(
        expect.arrayContaining([
          'public.submission.created',
          'admin.submission.assigned',
          'admin.submission.status',
          'admin.submission.note',
          'admin.submission.contact_attempt',
          'admin.submission.viewed',
        ]),
      );

      // Notifications go through the outbox: acknowledgement to the visitor, alert (reference only) to the team.
      await ctx.app.get(MaintenanceJobs).relayOutbox();
      const ack = ctx.mail.lastTo(email, 'submission_received');
      expect(ack?.text).toContain(ref);
      const alert = ctx.mail.sent.filter((m) => m.template === 'submission_staff_alert' && m.subject.includes(ref));
      expect(alert).toHaveLength(1);
      expect(alert[0].text).not.toContain(email);
      expect(ctx.mail.lastTo(admin.email, 'submission_assigned')?.subject).toContain(ref);
    });
  });

  describe('validation and abuse controls', () => {
    it('refuses unknown fields, fields the form does not have, missing consent, bad topics, phones and sizes', async () => {
      const c = await visitor();
      const base = forms.contact(uniq('val', 'example.com'));
      const bad = async (body: object, field?: string) => {
        const r = await c.post('/public/submissions', body);
        expect(r.status).toBe(400);
        if (field) expect(r.body.field).toBe(field);
      };
      await bad({ ...base, status: 'resolved' }); // mass assignment attempt
      await bad({ ...base, assigneeId: admin.id });
      await bad({ ...base, preferredAt: new Date().toISOString() }, 'preferredAt'); // not a contact-form field
      await bad({ ...base, consent: false }, 'consent');
      await bad({ ...base, topic: 'Free money' }, 'topic');
      await bad({ ...base, phone: '12' }, 'phone');
      await bad({ ...base, email: 'not-an-email' }, 'email');
      await bad({ ...base, message: 'x'.repeat(2001) }, 'message');
      await bad({ ...forms.internship_application(uniq('val', 'example.com')), email: undefined }, 'email');
      // program pages (30 Oct): "program · internship" topics are on the list; made-up ones are not
      await bad(
        { ...forms.internship_application(uniq('val2', 'example.com')), topic: 'Diploma · Free laptop' },
        'topic',
      );
      const prog = await c.post('/public/submissions', {
        ...forms.internship_application(uniq('prog', 'example.com')),
        topic: 'Expert Professional · VAPT Intern',
        sourcePage: 'index.html#program/expert-professional',
      });
      expect(prog.status).toBe(201);
      const huge = await c.post('/public/submissions', { ...base, message: 'x'.repeat(300_000) });
      expect(huge.status).toBe(413);
      expect(await ctx.prisma.publicSubmission.count({ where: { email: base.email } })).toBe(0);
    });

    it('honeypot: a filled spam trap is refused and nothing is stored', async () => {
      const body = { ...forms.contact(uniq('bot', 'example.com')), website: 'http://spam.example' };
      const r = await (await visitor()).post('/public/submissions', body);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('SUBMISSION_REJECTED');
      expect(await ctx.prisma.publicSubmission.count({ where: { email: body.email } })).toBe(0);
    });

    it('a double submit inside 10 minutes returns the first reference; an Idempotency-Key replays the same answer', async () => {
      const c = await visitor();
      const body = forms.mentorship_session(uniq('dup', 'example.com'));
      const one = await c.post('/public/submissions', body);
      const two = await c.post('/public/submissions', body);
      expect(one.status).toBe(201);
      expect(two.status).toBe(200);
      expect(two.body).toMatchObject({ reference: one.body.reference, duplicate: true });
      expect(await ctx.prisma.publicSubmission.count({ where: { email: body.email } })).toBe(1);

      const k = { 'Idempotency-Key': 'retry-key-0001' };
      const body2 = forms.contact(uniq('idem', 'example.com'));
      const r1 = await c.post('/public/submissions', body2, k);
      const r2 = await c.post('/public/submissions', body2, k);
      expect(r2.body.reference).toBe(r1.body.reference);
    });

    it('per-IP rate limit: the 11th form in an hour from one address gets 429', async () => {
      const c = await visitor();
      for (let i = 0; i < 10; i++)
        expect(
          (await c.post('/public/submissions', forms.internship_application(uniq(`rl${i}`, 'example.com')))).status,
        ).toBe(201);
      const r = await c.post('/public/submissions', forms.internship_application(uniq('rl-x', 'example.com')));
      expect(r.status).toBe(429);
    });

    it('needs the CSRF pre-session token', async () => {
      const c = new Client(ctx.server); // no init(): no token
      expect((await c.post('/public/submissions', forms.contact(uniq('csrf', 'example.com')))).status).toBe(403);
    });
  });

  describe('course enrolment request (signed-in student, from academy.html)', () => {
    it('needs a student session, takes identity from the account, and allows one open request per course', async () => {
      const anon = await (
        await visitor()
      ).post('/public/submissions', { type: 'course_enrolment', topic: 'SOC Analyst (Blue Team)' });
      expect(anon.status).toBe(401);
      const st = await makeStudent(ctx);
      const withName = await st.client.post('/public/submissions', {
        type: 'course_enrolment',
        topic: 'SOC Analyst (Blue Team)',
        name: 'Someone Else',
      });
      expect(withName.status).toBe(400);
      const one = await st.client.post('/public/submissions', {
        type: 'course_enrolment',
        topic: 'SOC Analyst (Blue Team)',
      });
      expect(one.status).toBe(201);
      const row = await ctx.prisma.publicSubmission.findUniqueOrThrow({ where: { reference: one.body.reference } });
      expect(row).toMatchObject({ userId: st.id, email: st.email, name: 'Test Student', consentKind: null });
      const two = await st.client.post('/public/submissions', {
        type: 'course_enrolment',
        topic: 'SOC Analyst (Blue Team)',
      });
      expect(two.body).toMatchObject({ duplicate: true, reference: one.body.reference });
      // No account is ever created by a public form.
      expect(await ctx.prisma.user.count({ where: { email: forms.contact('x').email } })).toBe(0);

      const trainer = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
      expect(
        (
          await trainer.client.post('/public/submissions', {
            type: 'course_enrolment',
            topic: 'SOC Analyst (Blue Team)',
          })
        ).status,
      ).toBe(403);
    });
  });

  describe('Admin LMS access and lifecycle rules', () => {
    it('only admins with the enquiries permission reach the inbox', async () => {
      expect((await (await visitor()).get('/admin/submissions')).status).toBe(401);
      const st = await makeStudent(ctx);
      expect((await st.client.get('/admin/submissions')).status).toBe(403);
      const t = await makeStaff(ctx, 'trainer', { capability: 'trainer_mentor' });
      expect((await t.client.get('/admin/submissions')).status).toBe(403);
      expect((await t.client.get('/admin/submissions/metrics')).status).toBe(403);
      expect((await admin.client.get('/admin/submissions')).status).toBe(200);
    });

    it('server-side transitions: illegal moves 409, closing needs a reason, a stale "from" is a 409 conflict', async () => {
      const r = await (await visitor()).post('/public/submissions', forms.contact(uniq('life', 'example.com')));
      const id = (await ctx.prisma.publicSubmission.findUniqueOrThrow({ where: { reference: r.body.reference } })).id;
      const illegal = await admin.client.post(`/admin/submissions/${id}/status`, { from: 'new', status: 'resolved' });
      expect(illegal.status).toBe(409);
      expect(illegal.body.code).toBe('TRANSITION_NOT_ALLOWED');
      const noReason = await admin.client.post(`/admin/submissions/${id}/status`, { from: 'new', status: 'closed' });
      expect(noReason.status).toBe(428);
      expect(
        (await admin.client.post(`/admin/submissions/${id}/status`, { from: 'new', status: 'reviewing' })).status,
      ).toBe(200);
      const stale = await admin.client.post(`/admin/submissions/${id}/status`, { from: 'new', status: 'in_progress' });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('SUBMISSION_CHANGED');
      const rejected = await admin.client.post(`/admin/submissions/${id}/status`, {
        from: 'reviewing',
        status: 'rejected',
        reason: 'Spam enquiry.',
      });
      expect(rejected.status).toBe(200);
      expect(
        (
          await admin.client.post(`/admin/submissions/${id}/status`, {
            from: 'rejected',
            status: 'in_progress',
            reason: 'Reopen',
          })
        ).status,
      ).toBe(409);
      // Only active admins can be assignees.
      const st = await makeStudent(ctx);
      const r2 = await (await visitor()).post('/public/submissions', forms.contact(uniq('asg', 'example.com')));
      const id2 = (await ctx.prisma.publicSubmission.findUniqueOrThrow({ where: { reference: r2.body.reference } })).id;
      expect((await admin.client.post(`/admin/submissions/${id2}/assign`, { assigneeId: st.id })).status).toBe(400);
    });

    it('filters, unassigned view, paging, metrics that agree with the records, and a safe CSV export', async () => {
      const list = await admin.client.get('/admin/submissions?limit=100');
      const all = await ctx.prisma.publicSubmission.count();
      expect(list.body.total).toBe(all);
      const unassigned = await admin.client.get('/admin/submissions?assignee=none&status=open&limit=5');
      expect(unassigned.body.items.every((x: { assignee: unknown }) => x.assignee === null)).toBe(true);
      if (unassigned.body.total > 5) expect(unassigned.body.nextCursor).toBeTruthy();
      const byType = await admin.client.get('/admin/submissions?type=internship_application&limit=100');
      expect(byType.body.items.every((x: { type: string }) => x.type === 'internship_application')).toBe(true);

      const m = await admin.client.get('/admin/submissions/metrics');
      expect(m.status).toBe(200);
      expect(m.body.total).toBe(all);
      const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
      expect(sum(m.body.byStatus)).toBe(all);
      expect(sum(m.body.byType)).toBe(all);
      expect(m.body.unassigned).toBe(
        await ctx.prisma.publicSubmission.count({
          where: {
            assigneeId: null,
            status: { in: ['new', 'reviewing', 'assigned', 'in_progress', 'waiting_for_user'] },
          },
        }),
      );
      expect(typeof m.body.averageResolutionHours === 'number' || m.body.averageResolutionHours === null).toBe(true);

      const evil = await (
        await visitor()
      ).post('/public/submissions', {
        ...forms.contact(uniq('csv', 'example.com')),
        name: '=HYPERLINK("http://x")',
      });
      const csv = await admin.client.get(`/admin/submissions/export?q=${evil.body.reference}`);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text).toContain(evil.body.reference);
      expect(csv.text).toContain(`"'=HYPERLINK`);
    });
  });

  describe('event reminders', () => {
    it('lists the website events, stores one reminder per email, and the emailed link unsubscribes', async () => {
      const ev = await (await visitor()).get('/public/events');
      const sprint = ev.body.items.find((e: { slug: string }) => e.slug === 'web-breakers-sprint');
      expect(sprint).toMatchObject({ remindable: true, name: 'Web Breakers Sprint' });

      const c = await visitor();
      const email = uniq('remind', 'example.com');
      const one = await c.post('/public/events/web-breakers-sprint/reminders', { email, consent: true });
      expect(one.status).toBe(201);
      const again = await c.post('/public/events/web-breakers-sprint/reminders', { email, consent: true });
      expect(again.body).toEqual(one.body); // same answer, no second row
      expect(await ctx.prisma.publicSubscription.count({ where: { email } })).toBe(1);
      expect(
        (
          await c.post('/public/events/web-breakers-sprint/reminders', {
            email: uniq('n', 'example.com'),
            consent: false,
          })
        ).status,
      ).toBe(400);
      expect((await c.post('/public/events/no-such-event/reminders', { email, consent: true })).status).toBe(404);

      const token = linkToken(ctx.mail.lastTo(email, 'subscription_confirmed')!.text, 'unsubscribe');
      const row = await ctx.prisma.publicSubscription.findFirstOrThrow({ where: { email } });
      expect(row.unsubscribeHash).not.toContain(token); // only the hash is stored
      const u = await c.post('/public/subscriptions/unsubscribe', { token });
      expect(u.body).toMatchObject({ status: 'unsubscribed', kind: 'event_reminder' });
      expect((await ctx.prisma.publicSubscription.findFirstOrThrow({ where: { email } })).status).toBe('unsubscribed');
      expect((await c.post('/public/subscriptions/unsubscribe', { token: 'x'.repeat(43) })).status).toBe(404);

      const events = await admin.client.get('/admin/events');
      const id = events.body.items.find((e: { slug: string }) => e.slug === 'web-breakers-sprint').id;
      expect((await admin.client.get(`/admin/events/${id}/reminders`)).status).toBe(200);
    });

    it('there is no newsletter (removed by the owner, OI-37)', async () => {
      const c = await visitor();
      const r = await c.post('/public/newsletter/subscriptions', { email: uniq('news', 'example.com'), consent: true });
      expect(r.status).toBe(404);
    });
  });

  describe('managed website content', () => {
    it('drafts stay private; publish rules apply; only admins edit', async () => {
      const slug = `faq-${Date.now().toString(36)}`;
      const created = await admin.client.post('/admin/content', {
        kind: 'faq',
        slug,
        title: 'Do I need prior knowledge?',
        body: 'No.',
      });
      expect(created.status).toBe(201);
      const pub = async () =>
        ((await (await visitor()).get('/public/content?kind=faq')).body.items as { slug: string }[]).map((x) => x.slug);
      expect(await pub()).not.toContain(slug);
      expect((await admin.client.post(`/admin/content/${created.body.id}/publish`)).status).toBe(200);
      expect(await pub()).toContain(slug);
      expect((await admin.client.post(`/admin/content/${created.body.id}/unpublish`)).status).toBe(200);
      expect(await pub()).not.toContain(slug);

      const t = await admin.client.post('/admin/content', {
        kind: 'testimonial',
        title: `Test Person ${Date.now().toString(36)}`,
        body: 'Quote',
        data: { role: 'SOC Analyst' },
      });
      const noConsent = await admin.client.post(`/admin/content/${t.body.id}/publish`);
      expect(noConsent.status).toBe(409);
      expect(noConsent.body.code).toBe('NOT_PUBLISHABLE');
      expect(
        (await admin.client.post('/admin/content', { kind: 'faq', title: 'x', data: { html: '<b>' } })).status,
      ).toBe(400);
      expect((await admin.client.post('/admin/content', { kind: 'faq', slug, title: 'dup' })).status).toBe(409);

      const st = await makeStudent(ctx);
      expect((await st.client.post('/admin/content', { kind: 'faq', title: 'Hack' })).status).toBe(403);
      expect((await (await visitor()).get('/public/content?kind=secrets')).status).toBe(400);
    });
  });
});
