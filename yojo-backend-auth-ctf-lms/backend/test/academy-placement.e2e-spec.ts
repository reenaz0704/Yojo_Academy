import { makeStaff, makeStudent, startApp, type StaffUser, type TestCtx } from './helpers';

/**
 * Slice (g): readiness recalculated from verified records (resume review, approved projects, recorded mock
 * interviews, verified milestones), ownership, trainer scope, URL safety, and admin milestone configuration.
 */
describe('Student Academy: Placement Mission', () => {
  let ctx: TestCtx;
  let admin: StaffUser, trainer: StaffUser, otherTrainer: StaffUser;
  let st: Awaited<ReturnType<typeof makeStudent>>, mate: Awaited<ReturnType<typeof makeStudent>>;
  const H = 3600_000;

  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    trainer = await makeStaff(ctx, 'trainer', { capability: 'trainer_mentor' });
    otherTrainer = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    st = await makeStudent(ctx);
    mate = await makeStudent(ctx);
    const b = await admin.client.post('/admin/batches', {
      code: `PL-${Date.now().toString(36)}`,
      name: 'Placement batch',
      trainerId: trainer.id,
      status: 'active',
    });
    for (const s of [st, mate]) await admin.client.post(`/admin/students/${s.id}/enrolments`, { batchId: b.body.id });
  });
  afterAll(async () => ctx.app.close());

  it('starts at zero and rises only through verified steps', async () => {
    const o = await st.client.get('/student/placement');
    expect(o.status).toBe(200);
    expect(o.body.overall).toBe(0);
    expect(o.body.weights).toEqual({ resume: 25, mock: 25, internship: 25, portfolio: 25 });
  });

  it('resume: submit needs an objective and skills; a trainer of the batch approves; edits wait for the review', async () => {
    expect((await st.client.post('/student/resume/submit')).status).toBe(400);
    await st.client.send('put', '/student/resume', {
      headline: 'Aspiring SOC analyst',
      objective: 'SOC analyst role in a product company',
      skills: ['Splunk', 'Linux'],
    });
    expect((await st.client.post('/student/resume/submit')).body.status).toBe('submitted');
    expect((await st.client.send('put', '/student/resume', { headline: 'Changed in review' })).status).toBe(409);
    expect(await ctx.prisma.resumeVersion.count({ where: { userId: st.id } })).toBe(1);
    expect((await otherTrainer.client.post(`/trainer/resumes/${st.id}/review`, { approve: true })).status).toBe(404);
    expect((await trainer.client.post(`/trainer/resumes/${st.id}/review`, { approve: false })).status).toBe(428);
    expect(
      (await trainer.client.post(`/trainer/resumes/${st.id}/review`, { approve: true, feedback: 'Clear and focused.' }))
        .body.status,
    ).toBe('approved');
    const r = await st.client.get('/student/resume');
    expect(r.body.review.status).toBe('approved');
    expect(r.body.pdf).toEqual({ available: false, reason: 'PDF_NOT_CONFIGURED' });
    expect((await st.client.get('/student/placement')).body.parts.resume.pct).toBe(100);
    // owner, 29 Oct: the resume carries the sign-up details and the career quiz / chosen team; filled details are locked
    expect(r.body).toMatchObject({ name: 'Test Student', careerPath: { path: null, quiz: null } });
    expect(
      (await st.client.send('put', '/student/resume', { objective: 'Something completely different' })).body.code,
    ).toBe('PROFILE_LOCKED');
    await st.client.post('/student/career-path', { path: 'Defensive' });
    expect((await st.client.get('/student/resume')).body.careerPath).toMatchObject({
      path: 'Defensive',
      team: 'Blue Team',
    });
  });

  it('portfolio: safe links only, ownership enforced, only approved projects count, edits reset approval', async () => {
    expect(
      (await st.client.post('/student/portfolio', { title: 'Bad link', repoUrl: 'javascript:alert(1)' })).status,
    ).toBe(400);
    const p = await st.client.post('/student/portfolio', {
      title: 'Brute-force detection lab',
      description: 'Detected password spraying in auth logs and wrote a Sigma rule.',
      skills: ['SIEM'],
      repoUrl: 'https://github.com/example/bf-lab',
    });
    expect(p.status).toBe(201);
    const short = await st.client.post('/student/portfolio', { title: 'Tiny', description: 'short' });
    expect((await st.client.post(`/student/portfolio/${short.body.id}/submit`)).status).toBe(400);
    expect((await mate.client.send('patch', `/student/portfolio/${p.body.id}`, { title: 'Stolen' })).status).toBe(404);
    expect((await mate.client.send('delete', `/student/portfolio/${p.body.id}`)).status).toBe(404);
    await st.client.post(`/student/portfolio/${p.body.id}/submit`);
    expect((await trainer.client.post(`/trainer/portfolio/${p.body.id}/review`, { approve: true })).body.status).toBe(
      'approved',
    );
    expect((await st.client.get('/student/placement')).body.parts.portfolio).toMatchObject({
      pct: 20,
      approved: 1,
      target: 5,
    });
    await st.client.send('patch', `/student/portfolio/${p.body.id}`, {
      description: 'Detected password spraying, now with a dashboard too.',
    });
    expect((await st.client.get('/student/placement')).body.parts.portfolio.approved).toBe(0);
  });

  it('internship milestones are configured by admins and verified by the trainer', async () => {
    const m = await admin.client.post('/admin/placement/milestones', { title: 'Upload a cover letter', sortOrder: 1 });
    expect(m.status).toBe(201);
    expect((await trainer.client.post('/admin/placement/milestones', { title: 'Hack' })).status).toBe(403);
    expect(
      (
        await st.client.post(`/student/milestones/${m.body.id}/submit`, {
          evidenceUrl: 'https://docs.example.invalid/cl',
          note: 'Done',
        })
      ).body.status,
    ).toBe('submitted');
    expect(
      (await trainer.client.post(`/trainer/milestones/${st.id}/${m.body.id}/verify`, { done: true })).body.status,
    ).toBe('done');
    const ms = (await st.client.get('/student/placement')).body.parts.internship;
    expect(ms.milestones.find((x: { id: string }) => x.id === m.body.id).status).toBe('done');
    await admin.client.post(`/admin/placement/milestones/${m.body.id}/active`, { active: false }); // keep other runs independent
  });

  it('mock interviews count only when the interviewing trainer records the result, once', async () => {
    const slot = await trainer.client.post('/trainer/slots', {
      startsAt: new Date(Date.now() + 30 * H).toISOString(),
      endsAt: new Date(Date.now() + 31 * H).toISOString(),
      kind: 'mock_interview',
    });
    const req = await st.client.post('/student/session-requests', { slotId: slot.body.id, purpose: 'mock_interview' });
    await trainer.client.post(`/trainer/session-requests/${req.body.id}/decide`, { decision: 'approve' });
    const body = {
      technical: 4,
      communication: 3,
      problemSolving: 4,
      passed: true,
      feedback: 'Good triage reasoning.',
    };
    expect((await trainer.client.post(`/trainer/session-requests/${req.body.id}/mock-result`, body)).status).toBe(409); // not started yet
    await ctx.prisma.sessionRequest.update({
      where: { id: req.body.id },
      data: { startsAt: new Date(Date.now() - H), endsAt: new Date(Date.now() - H / 2) },
    });
    expect((await otherTrainer.client.post(`/trainer/session-requests/${req.body.id}/mock-result`, body)).status).toBe(
      404,
    );
    expect(
      (await trainer.client.post(`/trainer/session-requests/${req.body.id}/mock-result`, { ...body, technical: 9 }))
        .status,
    ).toBe(400);
    expect((await trainer.client.post(`/trainer/session-requests/${req.body.id}/mock-result`, body)).status).toBe(201);
    expect((await trainer.client.post(`/trainer/session-requests/${req.body.id}/mock-result`, body)).status).toBe(409);
    const o = (await st.client.get('/student/placement')).body;
    // OI-49: half interviews done (1 of 3 = 33 %), half communication (3 of 5 = 60 %)
    expect(o.parts.mock).toMatchObject({
      done: 1,
      target: 3,
      interviewsPct: 33,
      communicationPct: 60,
      communicationAvg: 3,
      pct: 47,
    });
    expect(o.overall).toBe(
      Math.round((100 * 25 + 47 * 25 + o.parts.internship.pct * 25 + o.parts.portfolio.pct * 25) / 100),
    );
  });

  it('skill gaps and the admin readiness report', async () => {
    const g = await st.client.get('/student/placement/skill-gaps');
    expect(g.body.tracks.map((t: { track: string }) => t.track)).toEqual(['Offensive', 'Defensive', 'GRC']);
    expect(g.body.note).toMatch(/not a hiring prediction/);
    const batches = await ctx.prisma.enrolment.findFirstOrThrow({ where: { studentId: st.id } });
    const rep = await admin.client.get(`/admin/placement/report?batchId=${batches.batchId}`);
    expect(rep.body.students.find((x: { studentId: string }) => x.studentId === st.id).resume).toBe(100);
    expect((await st.client.get(`/admin/placement/report?batchId=${batches.batchId}`)).status).toBe(403);
  });
});
