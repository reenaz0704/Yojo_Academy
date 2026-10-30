import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentSession, Public, RequirePermission, Roles } from '../common/decorators/auth.decorators';
import { AppError } from '../common/errors/app-error';
import type { AppRequest } from '../common/http/request-context';
import { metaOf } from '../identity/http';
import { ContentService } from './content.service';
import {
  AssignDto,
  ContactAttemptDto,
  ContentCreateDto,
  ContentListQuery,
  ContentPatchDto,
  ContentQuery,
  CreateSubmissionDto,
  EventCreateDto,
  EventPatchDto,
  EventReminderDto,
  MetricsQuery,
  NoteDto,
  StatusDto,
  SubmissionListQuery,
  UnsubscribeDto,
} from './public-site.dto';
import { SubmissionsService, type Actor } from './submissions.service';
import { SubscriptionsService } from './subscriptions.service';

type Session = NonNullable<AppRequest['session']>;
const actorOf = (s: Session, req: AppRequest): Actor => ({ userId: s.userId, ...metaOf(req) });
const trap = (website?: string) => {
  if (website && website.trim())
    throw new AppError(400, 'SUBMISSION_REJECTED', 'This form could not be sent. Reload the page and try again.');
};

/** Public website: forms, reminders and published content. No account needed; CSRF pre-session token required. */
@ApiTags('public website')
@Controller('public')
export class PublicSiteController {
  constructor(
    private readonly submissions: SubmissionsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly content: ContentService,
  ) {}

  @Post('submissions')
  @Public()
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Same key within 24 h returns the same answer' })
  async submit(
    @Body() dto: CreateSubmissionDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') key?: string,
  ) {
    const idem = key && /^[\w-]{8,80}$/.test(key) ? key : undefined;
    const r = await this.submissions.create(
      dto,
      { userId: req.session?.userId, role: req.session?.role },
      metaOf(req),
      idem,
    );
    if (r.duplicate) res.status(200);
    return r;
  }

  @Get('events')
  @Public()
  events() {
    return this.subscriptions.publicEvents();
  }

  @Post('events/:slug/reminders')
  @Public()
  @HttpCode(201)
  remind(@Param('slug') slug: string, @Body() dto: EventReminderDto, @Req() req: AppRequest) {
    trap(dto.website);
    if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(slug)) throw new AppError(404, 'NOT_FOUND', 'No such event.');
    return this.subscriptions.remind(slug, dto.email, metaOf(req));
  }

  @Post('subscriptions/unsubscribe')
  @Public()
  @HttpCode(200)
  unsubscribe(@Body() dto: UnsubscribeDto, @Req() req: AppRequest) {
    return this.subscriptions.unsubscribe(dto.token, metaOf(req));
  }

  @Get('content')
  @Public()
  content_(@Query() q: ContentQuery) {
    return this.content.published(q.kind);
  }
}

/** Admin LMS → Enquiries. Platform Admin only (permission `enquiries`); trainers and students get 403. */
@ApiTags('admin: enquiries')
@Controller('admin/submissions')
@Roles('admin')
export class AdminSubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get()
  @RequirePermission('enquiries')
  list(@Query() q: SubmissionListQuery, @CurrentSession() s: Session) {
    return this.submissions.list(q, s.userId);
  }

  @Get('metrics')
  @RequirePermission('enquiries')
  metrics(@Query() q: MetricsQuery) {
    return this.submissions.metrics(q);
  }

  @Get('export')
  @RequirePermission('enquiries', 'Y')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="enquiries.csv"')
  export(@Query() q: SubmissionListQuery, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.submissions.exportCsv(q, actorOf(s, req));
  }

  @Get(':id')
  @RequirePermission('enquiries')
  detail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.submissions.detail(id, actorOf(s, req));
  }

  @Post(':id/assign')
  @RequirePermission('enquiries', 'Y')
  @HttpCode(200)
  assign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.submissions.assign(id, dto, actorOf(s, req));
  }

  @Post(':id/status')
  @RequirePermission('enquiries', 'Y')
  @HttpCode(200)
  status(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: StatusDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.submissions.setStatus(id, dto, actorOf(s, req));
  }

  @Post(':id/notes')
  @RequirePermission('enquiries', 'Y')
  @HttpCode(201)
  note(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: NoteDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.submissions.addNote(id, dto.body, actorOf(s, req));
  }

  @Post(':id/contact-attempts')
  @RequirePermission('enquiries', 'Y')
  @HttpCode(201)
  contact(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ContactAttemptDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.submissions.contactAttempt(id, dto, actorOf(s, req));
  }
}

/** Admin LMS → Website content (FAQ, testimonials, mentors, blog posts). Permission `website.content`. */
@ApiTags('admin: website content')
@Controller('admin/content')
@Roles('admin')
export class AdminContentController {
  constructor(private readonly content: ContentService) {}

  @Get()
  @RequirePermission('website.content')
  list(@Query() q: ContentListQuery) {
    return this.content.list(q);
  }

  @Post()
  @RequirePermission('website.content', 'Y')
  create(@Body() dto: ContentCreateDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.content.create(dto, actorOf(s, req));
  }

  @Patch(':id')
  @RequirePermission('website.content', 'Y')
  patch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ContentPatchDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.content.patch(id, dto, actorOf(s, req));
  }

  @Post(':id/publish')
  @RequirePermission('website.content', 'Y')
  @HttpCode(200)
  publish(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.content.setStatus(id, 'published', actorOf(s, req));
  }

  @Post(':id/unpublish')
  @RequirePermission('website.content', 'Y')
  @HttpCode(200)
  unpublish(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.content.setStatus(id, 'draft', actorOf(s, req));
  }

  @Post(':id/archive')
  @RequirePermission('website.content', 'Y')
  @HttpCode(200)
  archive(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.content.setStatus(id, 'archived', actorOf(s, req));
  }
}

/** Admin LMS → website events (CTF events listed on the CTF page) and their reminder lists. */
@ApiTags('admin: website events')
@Controller('admin/events')
@Roles('admin')
export class AdminEventsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @RequirePermission('website.content')
  list() {
    return this.subscriptions.adminEvents();
  }

  @Post()
  @RequirePermission('website.content', 'Y')
  create(@Body() dto: EventCreateDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.subscriptions.createEvent(dto, actorOf(s, req));
  }

  @Patch(':id')
  @RequirePermission('website.content', 'Y')
  patch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: EventPatchDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.subscriptions.patchEvent(id, dto, actorOf(s, req));
  }

  @Get(':id/reminders')
  @RequirePermission('enquiries')
  reminders(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.subscriptions.eventReminders(id, actorOf(s, req));
  }
}
