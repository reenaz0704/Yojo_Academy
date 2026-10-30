import { makeStaff, makeStudent, startApp, type StaffUser, type TestCtx } from './helpers';

/**
 * Slice (f): Intel blogs: drafts → admin review → publication, flag filter, author ownership, one reaction per user,
 * one view per user per day (and the "read a blog" daily patch), comments with moderation and reports, top blogs,
 * unpublishing, and the "3 live blogs" trophy.
 */
describe('Student Academy: Intel blogs', () => {
  let ctx: TestCtx;
  let admin: StaffUser;
  const tag = Date.now().toString(36);
  const BODY =
    'Start with the alert queue. Each alert has a severity, a source and a time. Before you act, ask three questions: what happened, where, and is it still happening?';

  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
  });
  afterAll(async () => ctx.app.close());

  async function publish(author: Awaited<ReturnType<typeof makeStudent>>, title: string) {
    const b = await author.client.post('/student/blogs', { title, body: BODY, tags: ['soc'] });
    expect(b.status).toBe(201);
    await author.client.post(`/student/blogs/${b.body.id}/submit`, { ownWork: true });
    const d = await admin.client.post(`/admin/blogs/${b.body.id}/decision`, { decision: 'approve' });
    expect(d.status).toBe(200);
    return { id: b.body.id as string, slug: d.body.slug as string };
  }

  it('drafts → review → changes requested → resubmitted → published; nothing goes live by itself', async () => {
    const a = await makeStudent(ctx);
    const other = await makeStudent(ctx);
    const flag = await a.client.post('/student/blogs', {
      title: 'My first lab write-up',
      body: 'The flag was YOJO{base64_is_not_encryption} lol',
    });
    expect(flag.status).toBe(400);
    expect(flag.body.code).toBe('CONTAINS_FLAG');
    const d = await a.client.post('/student/blogs', { title: `Reading SIEM alerts ${tag}`, body: 'Too short.' });
    expect(d.status).toBe(201);
    expect((await a.client.post(`/student/blogs/${d.body.id}/submit`, { ownWork: false })).status).toBe(400);
    expect((await a.client.post(`/student/blogs/${d.body.id}/submit`, { ownWork: true })).status).toBe(400); // under 20 words
    expect((await other.client.send('patch', `/student/blogs/${d.body.id}`, { body: BODY })).status).toBe(404);
    await a.client.send('patch', `/student/blogs/${d.body.id}`, { body: BODY });
    expect((await a.client.post(`/student/blogs/${d.body.id}/submit`, { ownWork: true })).body.status).toBe(
      'in_review',
    );
    expect(
      (await a.client.send('patch', `/student/blogs/${d.body.id}`, { title: 'Sneaky edit in review' })).status,
    ).toBe(409);
    expect((await other.client.get(`/intel/blogs?q=${tag}`)).body.total).toBe(0);

    const queue = await admin.client.get('/admin/blogs?status=in_review');
    expect(queue.body.map((x: { id: string }) => x.id)).toContain(d.body.id);
    // the admin Intel Review screen: author name and code for each blog, and counts per state for the tabs
    expect(queue.body.find((x: { id: string }) => x.id === d.body.id)).toMatchObject({
      author: 'Test Student',
      authorCode: expect.stringMatching(/^U-\d+$/),
    });
    const counts = await admin.client.get('/admin/blogs/counts');
    expect(counts.body.in_review).toBeGreaterThanOrEqual(1);
    expect((await a.client.get('/admin/blogs/counts')).status).toBe(403);
    expect(
      (await admin.client.post(`/admin/blogs/${d.body.id}/decision`, { decision: 'request_changes' })).status,
    ).toBe(428);
    expect(
      (
        await admin.client.post(`/admin/blogs/${d.body.id}/decision`, {
          decision: 'request_changes',
          note: 'Add one example alert.',
        })
      ).body.status,
    ).toBe('changes_requested');
    const mine = await a.client.get('/student/blogs');
    expect(mine.body.find((x: { id: string }) => x.id === d.body.id)).toMatchObject({
      status: 'changes_requested',
      reviewNote: 'Add one example alert.',
    });
    await a.client.send('patch', `/student/blogs/${d.body.id}`, {
      body: BODY + '\n\nExample: 214 failed logins from one IP in an hour.',
    });
    await a.client.post(`/student/blogs/${d.body.id}/submit`, { ownWork: true });
    const ok = await admin.client.post(`/admin/blogs/${d.body.id}/decision`, { decision: 'approve' });
    expect(ok.body).toMatchObject({ status: 'published', slug: `reading-siem-alerts-${tag}` });
    expect((await other.client.get(`/intel/blogs?q=${tag}`)).body.total).toBe(1);
    const hist = await admin.client.get(`/admin/blogs/${d.body.id}/history`);
    expect(hist.body.map((e: { action: string }) => e.action)).toEqual([
      'submitted',
      'request_changes',
      'submitted',
      'approve',
    ]);
  });

  it('reading counts one view per day and the daily patch; one reaction per user; comments are moderated', async () => {
    const a = await makeStudent(ctx);
    const r = await makeStudent(ctx);
    const blog = await publish(a, `Phishing headers decoded ${tag}`);
    await r.client.get(`/intel/blogs/${blog.slug}`);
    const second = await r.client.get(`/intel/blogs/${blog.slug}`);
    expect(second.body.views).toBe(1);
    await a.client.get(`/intel/blogs/${blog.slug}`); // the author's own read does not give them the patch
    expect((await a.client.post('/student/daily/read/claim')).status).toBe(409);
    expect((await r.client.post('/student/daily/read/claim')).status).toBe(200);

    await r.client.send('put', `/intel/blogs/${blog.id}/reaction`);
    const twice = await r.client.send('put', `/intel/blogs/${blog.id}/reaction`);
    expect(twice.body).toMatchObject({ reacted: true, reactions: 1 });
    expect((await r.client.send('delete', `/intel/blogs/${blog.id}/reaction`)).body.reactions).toBe(0);

    const c = await r.client.post(`/intel/blogs/${blog.id}/comments`, { body: 'Great breakdown, thanks!' });
    expect(c.status).toBe(201);
    const rep = await a.client.post('/intel/reports', { commentId: c.body.id, reason: 'Testing the report path' });
    expect(rep.status).toBe(201);
    expect((await admin.client.get('/admin/content-reports')).body.map((x: { id: string }) => x.id)).toContain(
      rep.body.id,
    );
    expect((await admin.client.post(`/admin/comments/${c.body.id}/hide`, {})).status).toBe(428);
    expect((await admin.client.post(`/admin/comments/${c.body.id}/hide`, { reason: 'Off topic' })).status).toBe(200);
    expect((await r.client.get(`/intel/blogs/${blog.slug}`)).body.comments).toEqual([]);
    expect(
      (await admin.client.post(`/admin/content-reports/${rep.body.id}/resolve`, { reason: 'Comment hidden' })).status,
    ).toBe(200);

    const top = await r.client.get('/intel/blogs/top');
    expect(top.status).toBe(200);
    expect(top.body.items.length).toBeLessThanOrEqual(5);
  });

  it('unpublishing needs a reason and hides the blog; three live blogs earn the trophy', async () => {
    const a = await makeStudent(ctx);
    const b1 = await publish(a, `Five Linux commands ${tag}`);
    await publish(a, `My first week in the SOC ${tag}`);
    await publish(a, `Risk register in 20 minutes ${tag}`);
    const ach = await a.client.get('/student/achievements');
    expect(ach.body.items.find((x: { code: string }) => x.code === 'blogs-3').earned).toBe(true);
    expect((await admin.client.post(`/admin/blogs/${b1.id}/unpublish`, {})).status).toBe(428);
    expect(
      (await admin.client.post(`/admin/blogs/${b1.id}/unpublish`, { reason: 'Contains a private screenshot' })).status,
    ).toBe(200);
    expect((await a.client.get(`/intel/blogs/${b1.slug}`)).status).toBe(404);
  });

  it('staff can read Intel; only admins moderate', async () => {
    const st = await makeStudent(ctx);
    const t = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    expect((await t.client.get('/intel/blogs')).status).toBe(200);
    for (const c of [st.client, t.client]) {
      expect((await c.get('/admin/blogs')).status).toBe(403);
      expect(
        (await c.post('/admin/blogs/00000000-0000-0000-0000-000000000000/decision', { decision: 'approve' })).status,
      ).toBe(403);
    }
    expect((await t.client.post('/student/blogs', { title: 'Trainer post', body: BODY })).status).toBe(403);
  });
});
