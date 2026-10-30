import { makeStaff, makeStudent, startApp, type Client, type StaffUser, type TestCtx } from './helpers';

/**
 * Owner (29 Oct): trainers upload files and folders by "type of content", and only matching files are accepted
 * (extension + MIME + magic bytes + size, checked on the server). Files go out only through GET /files/:id with a
 * permission check; uploads to a published course wait for a Platform Admin. Storage: local disk in dev/test (OI-45).
 */
describe('Trainer console: course file uploads', () => {
  let ctx: TestCtx;
  let admin: StaffUser, a: StaffUser, b: StaffUser;
  let st: Awaited<ReturnType<typeof makeStudent>>, outsider: Awaited<ReturnType<typeof makeStudent>>;
  const tag = Date.now().toString(36).toUpperCase();
  let course = '',
    pdfId = '',
    lessonModule = '';

  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)]);
  const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0)]);

  const up = (
    c: Client,
    kind: string,
    name: string,
    data: Buffer,
    extra: Record<string, string> = {},
    mime?: string,
  ) => {
    let r = c.agent
      .post(`/api/v1/trainer/courses/${course}/files`)
      .set('X-Forwarded-For', c.ip)
      .set('X-CSRF-Token', c.csrf)
      .field('kind', kind);
    for (const [k, v] of Object.entries(extra)) r = r.field(k, v);
    return r.attach('file', data, { filename: name, contentType: mime ?? 'application/octet-stream' });
  };

  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    a = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    b = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    st = await makeStudent(ctx);
    outsider = await makeStudent(ctx);
    const batch = await admin.client.post('/admin/batches', {
      code: `CF-${tag}`,
      name: 'Files batch',
      trainerId: a.id,
      status: 'active',
    });
    const c = await a.client.post('/trainer/courses', {
      title: `Files ${tag}`,
      track: 'Defensive',
      summary: 'Course for upload checks.',
      batchIds: [batch.body.id],
    });
    course = c.body.id;
    await admin.client.send('patch', `/admin/courses/${course}`, { access: 'free' });
    await admin.client.post(`/admin/students/${st.id}/enrolments`, { batchId: batch.body.id });
  });
  afterAll(async () => ctx.app.close());

  it('accepts only files matching the chosen type', async () => {
    const ok = await up(a.client, 'document', 'notes.pdf', PDF, {}, 'application/pdf');
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({
      kind: 'document',
      name: 'notes.pdf',
      mime: 'application/pdf',
      scanStatus: 'pending',
    });
    pdfId = ok.body.id;
    // wrong extension for the type
    expect((await up(a.client, 'video', 'notes.pdf', PDF)).body.code).toBe('FILE_TYPE_REFUSED');
    // an executable renamed to .pdf: the bytes give it away
    const fake = await up(a.client, 'document', 'invoice.pdf', EXE);
    expect(fake.status).toBe(422);
    expect(fake.body.message).toMatch(/not a real \.pdf/);
    // executables and scripts are on no list
    expect((await up(a.client, 'lab', 'tool.exe', EXE)).body.code).toBe('FILE_TYPE_REFUSED');
    expect((await up(a.client, 'lab', 'run.sh', Buffer.from('#!/bin/sh\nrm -rf /\n'))).body.code).toBe(
      'FILE_TYPE_REFUSED',
    );
    // a MIME type that contradicts the extension
    expect((await up(a.client, 'image', 'pic.png', PNG, {}, 'text/html')).body.code).toBe('FILE_TYPE_REFUSED');
    // size limit per type (cover images: 2 MB)
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 10)]);
    expect((await up(a.client, 'cover', 'big.png', big, {}, 'image/png')).body.message).toMatch(/up to 2 MB/);
    expect(await ctx.prisma.courseFile.count({ where: { courseId: course } })).toBe(1);
  });

  it('folders keep their paths; hidden files and unsafe paths are refused', async () => {
    const f = await up(a.client, 'lab', 'auth.log', Buffer.from('Oct 29 sshd: Failed password\n'), {
      relPath: 'week1/logs/auth.log',
    });
    expect(f.status).toBe(201);
    expect(f.body.relPath).toBe('week1/logs/auth.log');
    expect((await up(a.client, 'lab', '.DS_Store', Buffer.from('x'), { relPath: 'week1/.DS_Store' })).body.code).toBe(
      'SYSTEM_FILE',
    );
    expect((await up(a.client, 'lab', 'x.txt', Buffer.from('x'), { relPath: '../../etc/x.txt' })).status).toBe(400);
    const list = await a.client.get(`/trainer/courses/${course}/files`);
    expect(list.body.items.map((x: { relPath: string }) => x.relPath).sort()).toEqual([
      'notes.pdf',
      'week1/logs/auth.log',
    ]);
    expect(list.body.kinds.find((k: { kind: string }) => k.kind === 'video').ext).toEqual([
      'mp4',
      'm4v',
      'mov',
      'webm',
    ]);
  });

  it('only people who may see the course get the bytes', async () => {
    expect((await up(b.client, 'document', 'notes.pdf', PDF)).status).toBe(404);
    expect((await b.client.get(`/trainer/courses/${course}/files`)).status).toBe(404);
    expect((await b.client.get(`/files/${pdfId}`)).status).toBe(404);
    const own = await a.client.get(`/files/${pdfId}`);
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toMatch(/application\/pdf/);
    expect(own.headers['x-content-type-options']).toBe('nosniff');
    // a student sees a file only through a published lesson of a published course they can open
    expect((await st.client.get(`/files/${pdfId}`)).status).toBe(404);
    const m = await a.client.post(`/trainer/courses/${course}/modules`, { title: 'Week 1' });
    lessonModule = m.body.id;
    const l = await a.client.post(`/trainer/modules/${lessonModule}/lessons`, {
      title: 'Read the notes',
      type: 'document',
      status: 'published',
      fileId: pdfId,
    });
    expect(l.status).toBe(201);
    expect((await st.client.get(`/files/${pdfId}`)).status).toBe(404); // course still a draft
    expect((await a.client.post(`/trainer/courses/${course}/publish`)).status).toBe(200);
    const sees = await st.client.agent
      .get(`/api/v1/files/${pdfId}`)
      .set('X-Forwarded-For', st.client.ip)
      .buffer(true)
      .parse((res, cb) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => cb(null, Buffer.concat(parts)));
      });
    expect(sees.status).toBe(200);
    expect((sees.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const lesson = await st.client.get(`/student/lessons/${l.body.id}`);
    expect(lesson.body.file).toMatchObject({ name: 'notes.pdf', available: true, url: `/files/${pdfId}` });
    // a file of another course cannot be attached
    expect(
      (
        await admin.client.send('patch', `/admin/lessons/${l.body.id}`, {
          fileId: '00000000-0000-4000-8000-000000000000',
        })
      ).status,
    ).toBe(400);
  });

  it('published course: uploads and removals wait for a Platform Admin', async () => {
    expect((await up(a.client, 'cover', 'cover.png', PNG, {}, 'image/png')).status).toBe(400); // reason needed
    const c = await up(a.client, 'cover', 'cover.png', PNG, { reasonCode: 'content_correction' }, 'image/png');
    expect(c.status).toBe(202);
    expect(c.body.pending).toBe(true);
    const pendingFile = await ctx.prisma.courseFile.findFirstOrThrow({ where: { courseId: course, kind: 'cover' } });
    expect(pendingFile.status).toBe('pending');
    // students cannot fetch a pending file, and the course has no cover yet
    expect((await st.client.get(`/files/${pendingFile.id}`)).status).toBe(404);
    expect((await ctx.prisma.course.findUniqueOrThrow({ where: { id: course } })).coverFileId).toBeNull();
    await admin.client.post(`/admin/course-changes/${c.body.requestId}/decide`, { approve: true });
    expect((await ctx.prisma.course.findUniqueOrThrow({ where: { id: course } })).coverFileId).toBe(pendingFile.id);
    expect((await outsider.client.get(`/files/${pendingFile.id}`)).status).toBe(200); // a published cover is public to students
    // removing a file of a published course is a change request; rejecting keeps it
    const del = await a.client.send('delete', `/trainer/files/${pdfId}`, { reasonCode: 'outdated' });
    expect(del.status).toBe(202);
    expect((await st.client.get(`/files/${pdfId}`)).status).toBe(200);
    await admin.client.post(`/admin/course-changes/${del.body.requestId}/decide`, { approve: true });
    expect((await st.client.get(`/files/${pdfId}`)).status).toBe(404);
    expect((await ctx.prisma.lesson.findFirstOrThrow({ where: { moduleId: lessonModule } })).fileKey).toBeNull();
    // a rejected upload is removed
    const x = await up(a.client, 'document', 'extra.pdf', PDF, { reasonCode: 'restructure' }, 'application/pdf');
    await admin.client.post(`/admin/course-changes/${x.body.requestId}/decide`, {
      approve: false,
      note: 'Not needed now.',
    });
    expect(
      (await ctx.prisma.courseFile.findFirstOrThrow({ where: { name: 'extra.pdf', courseId: course } })).status,
    ).toBe('removed');
    expect(
      await ctx.prisma.auditLog.count({ where: { targetId: course, action: 'trainer.course.file_uploaded' } }),
    ).toBeGreaterThanOrEqual(4);
  });
});
