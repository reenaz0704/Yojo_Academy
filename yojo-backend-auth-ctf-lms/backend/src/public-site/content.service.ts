import { Injectable } from '@nestjs/common';
import { Prisma, type PublicContentKind } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import type { ContentCreateDto, ContentListQuery, ContentPatchDto } from './public-site.dto';
import type { Actor } from './submissions.service';

type Field =
  | { type: 'string'; max: number; enum?: string[] }
  | { type: 'int'; min: number; max: number }
  | { type: 'bool' }
  | { type: 'strings'; maxItems: number; max: number };

/**
 * Allow-listed `data` fields per kind. Anything else is refused. Text is stored as typed and always escaped when
 * rendered; no field holds HTML. `publishRequires` lists fields that must be true before an item can go live.
 */
export const DATA_RULES: Record<PublicContentKind, { fields: Record<string, Field>; publishRequires: string[] }> = {
  faq: { fields: {}, publishRequires: [] },
  testimonial: {
    fields: {
      role: { type: 'string', max: 80 },
      city: { type: 'string', max: 60 },
      // The person agreed to their quote, name and role being published (keep the written consent on file).
      consentConfirmed: { type: 'bool' },
    },
    publishRequires: ['consentConfirmed'],
  },
  mentor: {
    fields: {
      role: { type: 'string', max: 80 },
      track: { type: 'string', max: 30, enum: ['Offensive', 'Defensive', 'Cloud', 'GRC'] },
      certs: { type: 'strings', maxItems: 8, max: 30 },
      initials: { type: 'string', max: 3 },
      placed: { type: 'string', max: 8 },
      rating: { type: 'string', max: 4 },
      mockInterviews: { type: 'string', max: 8 },
      // Card figures (learners placed, rating, mock interviews) must come from records the team can show if asked.
      figuresVerified: { type: 'bool' },
    },
    publishRequires: [],
  },
  post: {
    fields: {
      author: { type: 'string', max: 60 },
      category: { type: 'string', max: 20, enum: ['Defensive', 'Offensive', 'GRC', 'CTF', 'Career'] },
      minutes: { type: 'int', min: 1, max: 120 },
      excerpt: { type: 'string', max: 300 },
      featured: { type: 'bool' },
      // "Every post is reviewed by a mentor before it goes live" (Lore Vault copy).
      mentorApproved: { type: 'bool' },
    },
    publishRequires: ['mentorApproved'],
  },
};

const adminSelect = {
  id: true,
  kind: true,
  slug: true,
  title: true,
  body: true,
  data: true,
  status: true,
  sortOrder: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PublicContentSelect;

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Public: published items of one kind, in display order. Drafts and archived items never leave the server. */
  async published(kind: PublicContentKind) {
    const rows = await this.prisma.publicContent.findMany({
      where: { kind, status: 'published' },
      orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'desc' }],
      select: { slug: true, title: true, body: true, data: true, publishedAt: true },
      take: 200,
    });
    return { kind, items: rows.map((r) => ({ ...r, data: publicData(kind, r.data) })) };
  }

  list(q: ContentListQuery) {
    return this.prisma.publicContent
      .findMany({
        where: { ...(q.kind ? { kind: q.kind } : {}), ...(q.status ? { status: q.status } : {}) },
        orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
        select: adminSelect,
        take: 500,
      })
      .then((items) => ({ items }));
  }

  async create(dto: ContentCreateDto, actor: Actor) {
    const data = cleanData(dto.kind, dto.data ?? {});
    const slug = dto.slug ?? slugify(dto.title);
    try {
      const row = await this.prisma.publicContent.create({
        data: {
          kind: dto.kind,
          slug,
          title: dto.title.trim(),
          body: dto.body ?? '',
          data,
          sortOrder: dto.sortOrder ?? 0,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        select: adminSelect,
      });
      await this.log('admin.content.created', row.id, actor, { kind: row.kind, slug });
      return row;
    } catch (e) {
      throw slugConflict(e);
    }
  }

  async patch(id: string, dto: ContentPatchDto, actor: Actor) {
    const cur = await this.prisma.publicContent.findUnique({
      where: { id },
      select: { kind: true, status: true, data: true },
    });
    if (!cur) throw Errors.notFound('No content item with that ID.');
    const data = dto.data ? cleanData(cur.kind, dto.data) : undefined;
    if (cur.status === 'published' && data) assertPublishable(cur.kind, data);
    try {
      const row = await this.prisma.publicContent.update({
        where: { id },
        data: {
          ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.body !== undefined ? { body: dto.body } : {}),
          ...(data ? { data } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          updatedById: actor.userId,
        },
        select: adminSelect,
      });
      await this.log('admin.content.updated', id, actor, { fields: Object.keys(dto) });
      return row;
    } catch (e) {
      throw slugConflict(e);
    }
  }

  async setStatus(id: string, status: 'published' | 'draft' | 'archived', actor: Actor) {
    const cur = await this.prisma.publicContent.findUnique({
      where: { id },
      select: { kind: true, status: true, data: true },
    });
    if (!cur) throw Errors.notFound('No content item with that ID.');
    if (status === 'published') assertPublishable(cur.kind, cur.data);
    const row = await this.prisma.publicContent.update({
      where: { id },
      data: { status, publishedAt: status === 'published' ? new Date() : undefined, updatedById: actor.userId },
      select: adminSelect,
    });
    await this.log(`admin.content.${status}`, id, actor, { kind: cur.kind, from: cur.status });
    return row;
  }

  private log(action: string, id: string, actor: Actor, detail: Record<string, unknown>) {
    return this.audit.record({
      action,
      actorId: actor.userId,
      actorRole: 'admin',
      targetType: 'public_content',
      targetId: id,
      detail,
      ip: actor.ip,
      requestId: actor.requestId,
    });
  }
}

export function cleanData(kind: PublicContentKind, input: Record<string, unknown>): Prisma.InputJsonObject {
  const rules = DATA_RULES[kind].fields;
  const out: Record<string, Prisma.InputJsonValue> = {};
  for (const [k, v] of Object.entries(input)) {
    const f = rules[k];
    if (!f) throw Errors.validation(`"${k}" is not a field of ${kind} items.`, `data.${k}`);
    if (v === null || v === undefined || v === '') continue;
    if (f.type === 'string') {
      if (typeof v !== 'string' || v.length > f.max)
        throw Errors.validation(`${k}: text up to ${f.max} characters.`, `data.${k}`);
      if (f.enum && !f.enum.includes(v)) throw Errors.validation(`${k}: one of ${f.enum.join(', ')}.`, `data.${k}`);
      out[k] = v.trim();
    } else if (f.type === 'int') {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < f.min || v > f.max)
        throw Errors.validation(`${k}: a whole number from ${f.min} to ${f.max}.`, `data.${k}`);
      out[k] = v;
    } else if (f.type === 'bool') {
      if (typeof v !== 'boolean') throw Errors.validation(`${k}: true or false.`, `data.${k}`);
      out[k] = v;
    } else {
      if (!Array.isArray(v) || v.length > f.maxItems || v.some((x) => typeof x !== 'string' || x.length > f.max))
        throw Errors.validation(`${k}: up to ${f.maxItems} short texts.`, `data.${k}`);
      out[k] = (v as string[]).map((x) => x.trim()).filter(Boolean);
    }
  }
  return out;
}

function assertPublishable(kind: PublicContentKind, data: Prisma.JsonValue | Prisma.InputJsonObject) {
  const d = (data ?? {}) as Record<string, unknown>;
  const missing = DATA_RULES[kind].publishRequires.filter((k) => d[k] !== true);
  if (missing.length)
    throw new AppError(409, 'NOT_PUBLISHABLE', `Confirm ${missing.join(', ')} before publishing.`, {
      field: `data.${missing[0]}`,
    });
}

/** Internal confirmation flags are not shown to visitors. */
function publicData(kind: PublicContentKind, data: Prisma.JsonValue) {
  const d = { ...((data ?? {}) as Record<string, unknown>) };
  delete d.consentConfirmed;
  delete d.mentorApproved;
  delete d.figuresVerified;
  if (kind === 'mentor' && (data as Record<string, unknown> | null)?.figuresVerified !== true) {
    delete d.placed;
    delete d.rating;
    delete d.mockInterviews;
  }
  return d;
}

export function slugify(t: string): string {
  const s = t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return s || `item-${Date.now().toString(36)}`;
}

function slugConflict(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
    return Errors.conflict('SLUG_TAKEN', 'Another item of this kind already uses this address. Change the slug.');
  return e;
}
