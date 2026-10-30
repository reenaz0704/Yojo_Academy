import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors/app-error';
import { RateLimitService } from '../common/guards/rate-limit.service';
import type { RequestMeta } from '../identity/types';
import { PrismaService } from '../prisma/prisma.service';
import { GamificationService } from './gamification.service';
import { NotificationsService } from './notifications.service';
import { dateCol, istDay } from './ist';

type Actor = RequestMeta & { userId: string };
const EDITABLE = ['draft', 'changes_requested'] as const;
const FLAG_RE = /YOJO[_{][^\s]{2,}/i;
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/**
 * Intel (docs/ACADEMY-INVENTORY.md, slice f). Students write blogs; nothing goes live until an admin approves it.
 * Bodies are plain text (rendered escaped). Engagement comes from stored rows: one reaction per user, comments,
 * at most one counted view per user per IST day. Top blogs: score = reactions×3 + comments×5 + views÷10 (the
 * prototype's formula), published only, ties → newer first.
 */
@Injectable()
export class IntelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly game: GamificationService,
    private readonly rate: RateLimitService,
    private readonly notes: NotificationsService,
  ) {}

  // ───────────── readers ─────────────

  async list(userId: string, q: { q?: string; tag?: string; limit?: number; cursor?: string }) {
    const where: Prisma.BlogWhereInput = {
      status: 'published',
      ...(q.q ? { title: { contains: q.q, mode: 'insensitive' } } : {}),
      ...(q.tag ? { tags: { has: q.tag } } : {}),
    };
    const limit = Math.min(q.limit ?? 20, 50);
    const skip = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString()) || 0 : 0;
    const [rows, total] = await Promise.all([
      this.prisma.blog.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip,
        take: limit + 1,
        include: this.statsInclude(userId),
      }),
      this.prisma.blog.count({ where }),
    ]);
    const authors = await this.authors(rows.map((r) => r.authorId));
    return {
      total,
      items: rows.slice(0, limit).map((b) => this.card(b, authors)),
      nextCursor: rows.length > limit ? Buffer.from(String(skip + limit)).toString('base64url') : null,
    };
  }

  async top(userId: string) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT b.id FROM blogs b
      WHERE b.status = 'published'
      ORDER BY ((SELECT COUNT(*) FROM blog_reactions r WHERE r.blog_id = b.id) * 3
              + (SELECT COUNT(*) FROM blog_comments c WHERE c.blog_id = b.id AND c.status = 'visible') * 5
              + (SELECT COUNT(*) FROM blog_views v WHERE v.blog_id = b.id) / 10.0) DESC, b.published_at DESC
      LIMIT 5`;
    const blogs = await this.prisma.blog.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      include: this.statsInclude(userId),
    });
    const authors = await this.authors(blogs.map((b) => b.authorId));
    const order = new Map(rows.map((r, i) => [r.id, i]));
    return {
      rule: 'score = reactions×3 + comments×5 + views÷10; published blogs only',
      items: blogs.sort((a, b) => order.get(a.id)! - order.get(b.id)!).map((b) => this.card(b, authors)),
    };
  }

  /** Reading a blog counts one view per day and, for students, the "read a blog" daily patch. */
  async read(userId: string, role: string, slug: string) {
    const b = await this.prisma.blog.findFirst({
      where: { slug, status: 'published' },
      include: this.statsInclude(userId),
    });
    if (!b) throw Errors.notFound('This blog is not available.');
    const day = istDay();
    await this.prisma.blogView.createMany({
      data: [{ blogId: b.id, userId, day: dateCol(day) }],
      skipDuplicates: true,
    });
    if (role === 'student' && b.authorId !== userId) {
      await this.game.recordActivity(userId, 'blog_read', b.id);
      await this.game.afterChange(userId);
    }
    const comments = await this.prisma.blogComment.findMany({
      where: { blogId: b.id, status: 'visible' },
      orderBy: { createdAt: 'asc' },
      take: 300,
    });
    const authors = await this.authors([b.authorId, ...comments.map((c) => c.authorId)]);
    return {
      ...this.card(b, authors),
      body: b.body,
      comments: comments.map((c) => ({
        id: c.id,
        author: authors.get(c.authorId) ?? 'Learner',
        body: c.body,
        at: c.createdAt,
        mine: c.authorId === userId,
      })),
    };
  }

  async react(userId: string, blogId: string, on: boolean) {
    await this.published(blogId);
    if (on) await this.prisma.blogReaction.createMany({ data: [{ blogId, userId }], skipDuplicates: true });
    else await this.prisma.blogReaction.deleteMany({ where: { blogId, userId } });
    return { reacted: on, reactions: await this.prisma.blogReaction.count({ where: { blogId } }) };
  }

  async comment(userId: string, blogId: string, body: string) {
    await this.published(blogId);
    await this.rate.hitClass('comment_user', userId);
    const c = await this.prisma.blogComment.create({ data: { blogId, authorId: userId, body: body.trim() } });
    return { id: c.id, at: c.createdAt };
  }

  async report(userId: string, target: { blogId?: string; commentId?: string }, reason: string) {
    if (target.blogId) await this.published(target.blogId);
    if (
      target.commentId &&
      !(await this.prisma.blogComment.count({ where: { id: target.commentId, status: 'visible' } }))
    )
      throw Errors.notFound('No comment with that ID.');
    await this.rate.hitClass('comment_user', userId);
    const r = await this.prisma.contentReport.create({
      data: { blogId: target.blogId, commentId: target.commentId, reporterId: userId, reason },
    });
    return { id: r.id, status: 'open' };
  }

  // ───────────── authors (students) ─────────────

  mine(userId: string) {
    return this.prisma.blog.findMany({
      where: { authorId: userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        slug: true,
        title: true,
        body: true,
        status: true,
        reviewNote: true,
        submittedAt: true,
        publishedAt: true,
        updatedAt: true,
        readingMinutes: true,
      },
    });
  }

  async create(userId: string, dto: { title: string; body: string; tags?: string[] }) {
    this.checkText(dto.title, dto.body);
    return this.prisma.blog.create({
      data: {
        authorId: userId,
        title: dto.title.trim(),
        body: dto.body,
        tags: dto.tags ?? [],
        readingMinutes: Math.max(1, Math.round(words(dto.body) / 200)),
      },
      select: { id: true, status: true },
    });
  }

  async edit(userId: string, id: string, dto: { title?: string; body?: string; tags?: string[] }) {
    const b = await this.own(userId, id);
    if (!(EDITABLE as readonly string[]).includes(b.status))
      throw new AppError(409, 'NOT_EDITABLE', 'Only drafts and blogs sent back for changes can be edited.');
    this.checkText(dto.title ?? b.title, dto.body ?? b.body);
    return this.prisma.blog.update({
      where: { id },
      data: {
        ...(dto.title ? { title: dto.title.trim() } : {}),
        ...(dto.body ? { body: dto.body, readingMinutes: Math.max(1, Math.round(words(dto.body) / 200)) } : {}),
        ...(dto.tags ? { tags: dto.tags } : {}),
      },
      select: { id: true, status: true, updatedAt: true },
    });
  }

  async submit(userId: string, id: string, ownWork: boolean) {
    if (!ownWork)
      throw Errors.validation('Confirm this is your own work with no lab flags or private data.', 'ownWork');
    const b = await this.own(userId, id);
    if (!(EDITABLE as readonly string[]).includes(b.status))
      throw new AppError(409, 'NOT_EDITABLE', `This blog is ${b.status.replace('_', ' ')}.`);
    if (words(b.body) < 20)
      throw Errors.validation('Write at least a few lines (20 words) before sending it for review.', 'body');
    await this.prisma.$transaction([
      this.prisma.blog.update({ where: { id }, data: { status: 'in_review', submittedAt: new Date() } }),
      this.prisma.blogEvent.create({ data: { blogId: id, actorId: userId, action: 'submitted' } }),
    ]);
    return { id, status: 'in_review' };
  }

  async removeDraft(userId: string, id: string) {
    const b = await this.own(userId, id);
    if (b.status !== 'draft' || b.submittedAt)
      throw new AppError(409, 'NOT_EDITABLE', 'Only a draft that was never sent for review can be deleted.');
    await this.prisma.blog.delete({ where: { id } });
  }

  // ───────────── admin moderation ─────────────

  /** Admin queue for one status, oldest submission first, with the author's name and student code. */
  async queue(status: string) {
    const rows = await this.prisma.blog.findMany({
      where: { status: status as Prisma.EnumBlogStatusFilter['equals'] },
      orderBy: { submittedAt: 'asc' },
      take: 200,
      select: {
        id: true,
        title: true,
        body: true,
        tags: true,
        authorId: true,
        status: true,
        readingMinutes: true,
        submittedAt: true,
        publishedAt: true,
        slug: true,
        reviewNote: true,
      },
    });
    const people = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } },
      select: { id: true, code: true, displayName: true, studentProfile: { select: { name: true } } },
    });
    const who = new Map(people.map((p) => [p.id, p]));
    return rows.map((r) => {
      const p = who.get(r.authorId);
      return { ...r, author: p ? (p.studentProfile?.name ?? p.displayName) : null, authorCode: p?.code ?? null };
    });
  }

  /** How many blogs are in each moderation state (admin tabs). */
  async queueCounts() {
    const rows = await this.prisma.blog.groupBy({
      by: ['status'],
      where: { status: { not: 'draft' } },
      _count: { _all: true },
    });
    const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
    return {
      in_review: n('in_review'),
      changes_requested: n('changes_requested'),
      published: n('published'),
      rejected: n('rejected'),
      unpublished: n('unpublished'),
    };
  }

  async decide(actor: Actor, id: string, decision: 'approve' | 'request_changes' | 'reject', note?: string) {
    const b = await this.prisma.blog.findUnique({ where: { id } });
    if (!b) throw Errors.notFound('No blog with that ID.');
    if (b.status !== 'in_review')
      throw new AppError(409, 'NOT_IN_REVIEW', `This blog is ${b.status.replace('_', ' ')}.`);
    if (decision !== 'approve' && (!note || note.trim().length < 5)) throw Errors.reasonRequired();
    const status = decision === 'approve' ? 'published' : decision === 'reject' ? 'rejected' : 'changes_requested';
    let slug = b.slug;
    if (decision === 'approve' && !slug) slug = await this.freeSlug(b.title);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.blog.updateMany({
        where: { id, status: 'in_review' },
        data: {
          status,
          reviewerId: actor.userId,
          reviewNote: note ?? null,
          ...(decision === 'approve' ? { slug, publishedAt: b.publishedAt ?? new Date() } : {}),
        },
      });
      if (!r.count) throw new AppError(409, 'NOT_IN_REVIEW', 'Someone else just reviewed this blog.');
      await tx.blogEvent.create({ data: { blogId: id, actorId: actor.userId, action: decision, note } });
      await this.audit.record(
        {
          action: `admin.blog.${decision}`,
          actorId: actor.userId,
          actorRole: 'admin',
          targetType: 'blog',
          targetId: id,
          reason: note,
          ip: actor.ip,
          requestId: actor.requestId,
        },
        tx,
      );
    });
    if (decision === 'approve') await this.game.afterChange(b.authorId); // "3 live blogs" trophy
    const word = { approve: 'is live', request_changes: 'needs changes', reject: 'was not accepted' }[decision];
    await this.notes.notify(b.authorId, {
      kind: 'blog',
      title: `Your blog ${word}: ${b.title}`,
      body: note ?? '',
      link: '#/academy/lore-vault',
      dedupeKey: `blog:${id}:${decision}:${Date.now()}`,
    });
    return { id, status, slug };
  }

  async unpublish(actor: Actor, id: string, reason: string) {
    const r = await this.prisma.blog.updateMany({
      where: { id, status: 'published' },
      data: { status: 'unpublished', reviewNote: reason },
    });
    if (!r.count) throw Errors.notFound('No published blog with that ID.');
    await this.prisma.blogEvent.create({
      data: { blogId: id, actorId: actor.userId, action: 'unpublished', note: reason },
    });
    await this.audit.record({
      action: 'admin.blog.unpublished',
      actorId: actor.userId,
      actorRole: 'admin',
      targetType: 'blog',
      targetId: id,
      reason,
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return { id, status: 'unpublished' };
  }

  async hideComment(actor: Actor, id: string, reason: string) {
    const r = await this.prisma.blogComment.updateMany({
      where: { id, status: 'visible' },
      data: { status: 'hidden', hiddenBy: actor.userId, hiddenWhy: reason },
    });
    if (!r.count) throw Errors.notFound('No visible comment with that ID.');
    await this.audit.record({
      action: 'admin.comment.hidden',
      actorId: actor.userId,
      actorRole: 'admin',
      targetType: 'blog_comment',
      targetId: id,
      reason,
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return { id, status: 'hidden' };
  }

  reports() {
    return this.prisma.contentReport.findMany({ where: { status: 'open' }, orderBy: { createdAt: 'asc' }, take: 200 });
  }

  async resolveReport(actor: Actor, id: string, resolution: string) {
    const r = await this.prisma.contentReport.updateMany({
      where: { id, status: 'open' },
      data: { status: 'resolved', resolvedBy: actor.userId, resolution },
    });
    if (!r.count) throw Errors.notFound('No open report with that ID.');
    return { id, status: 'resolved' };
  }

  history(id: string) {
    return this.prisma.blogEvent.findMany({ where: { blogId: id }, orderBy: { at: 'asc' } });
  }

  // ───────────── helpers ─────────────

  private checkText(title: string, body: string) {
    if (FLAG_RE.test(title) || FLAG_RE.test(body))
      throw new AppError(
        400,
        'CONTAINS_FLAG',
        'Remove lab flags (YOJO{…} or YOJO_…) before saving. Write-ups must not give answers away.',
      );
  }

  private async own(userId: string, id: string) {
    const b = await this.prisma.blog.findUnique({ where: { id } });
    if (!b || b.authorId !== userId) throw Errors.notFound('No blog of yours with that ID.');
    return b;
  }

  private async published(id: string) {
    const b = await this.prisma.blog.findFirst({ where: { id, status: 'published' }, select: { id: true } });
    if (!b) throw Errors.notFound('This blog is not available.');
  }

  private async freeSlug(title: string) {
    const base =
      title
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'blog';
    for (let i = 0; i < 50; i++) {
      const s = i ? `${base}-${i + 1}` : base;
      if (!(await this.prisma.blog.count({ where: { slug: s } }))) return s;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  private statsInclude(userId: string) {
    return {
      _count: { select: { reactions: true, views: true, comments: { where: { status: 'visible' as const } } } },
      reactions: { where: { userId }, select: { userId: true } },
    } satisfies Prisma.BlogInclude;
  }

  private card(
    b: Prisma.BlogGetPayload<{ include: ReturnType<IntelService['statsInclude']> }>,
    authors: Map<string, string>,
  ) {
    return {
      id: b.id,
      slug: b.slug,
      title: b.title,
      excerpt: b.body.split(/\n\s*\n/)[0].slice(0, 280),
      author: authors.get(b.authorId) ?? 'Learner',
      tags: b.tags,
      readingMinutes: b.readingMinutes,
      publishedAt: b.publishedAt,
      reactions: b._count.reactions,
      comments: b._count.comments,
      views: b._count.views,
      reacted: b.reactions.length > 0,
    };
  }

  private async authors(ids: string[]) {
    const rows = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: {
        id: true,
        displayName: true,
        staffProfile: { select: { displayName: true } },
        studentProfile: { select: { name: true, displayName: true } },
      },
    });
    return new Map(
      rows.map((u) => [
        u.id,
        u.studentProfile?.displayName ??
          u.studentProfile?.name ??
          u.staffProfile?.displayName ??
          u.displayName ??
          'Learner',
      ]),
    );
  }

  /** Used by the achievements rule "blogs_published". */
  async publishedCount(userId: string) {
    return this.prisma.blog.count({ where: { authorId: userId, status: 'published' } });
  }
}
