import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentSession, RequirePermission, RequireReason, Roles } from '../common/decorators/auth.decorators';
import { AppError } from '../common/errors/app-error';
import type { AppRequest } from '../common/http/request-context';
import { metaOf } from '../identity/http';
import { IntelService } from './intel.service';

type Session = NonNullable<AppRequest['session']>;
const actorOf = (s: Session, req: AppRequest) => ({ userId: s.userId, ...metaOf(req) });

class BlogQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) q?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z0-9-]{2,30}$/) tag?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) cursor?: string;
}
class BlogDto {
  @ApiProperty() @IsString() @Length(5, 150) title!: string;
  @ApiProperty({ description: 'Plain text; blank lines separate paragraphs' })
  @IsString()
  @Length(1, 30000)
  body!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @Matches(/^[a-z0-9-]{2,30}$/, { each: true })
  tags?: string[];
}
class BlogPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(5, 150) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30000) body?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @Matches(/^[a-z0-9-]{2,30}$/, { each: true })
  tags?: string[];
}
class SubmitBlogDto {
  @ApiProperty({ description: 'This is my own work and has no lab flags or private data' })
  @Equals(true, { message: 'Confirm this is your own work with no lab flags or private data.' })
  ownWork!: boolean;
}
class CommentDto {
  @ApiProperty() @IsString() @Length(1, 2000) body!: string;
}
class ReportDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() blogId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() commentId?: string;
  @ApiProperty() @IsString() @Length(5, 500) reason!: string;
}
class DecisionDto {
  @ApiProperty({ enum: ['approve', 'request_changes', 'reject'] })
  @IsIn(['approve', 'request_changes', 'reject'])
  decision!: 'approve' | 'request_changes' | 'reject';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
class ReasonDto {
  @ApiProperty() @IsString() @Length(5, 500) reason!: string;
}
class QueueQuery {
  @ApiPropertyOptional({ enum: ['in_review', 'changes_requested', 'published', 'rejected', 'unpublished'] })
  @IsOptional()
  @IsIn(['in_review', 'changes_requested', 'published', 'rejected', 'unpublished'])
  status?: string;
}

/** Intel feed for signed-in Academy users (students and staff). Published blogs only. */
@ApiTags('intel')
@Controller('intel')
@Roles('student', 'trainer', 'admin')
export class IntelController {
  constructor(private readonly intel: IntelService) {}

  @Get('blogs')
  list(@Query() q: BlogQuery, @CurrentSession() s: Session) {
    return this.intel.list(s.userId, q);
  }

  @Get('blogs/top')
  top(@CurrentSession() s: Session) {
    return this.intel.top(s.userId);
  }

  @Get('blogs/:slug')
  read(@Param('slug') slug: string, @CurrentSession() s: Session) {
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) throw new AppError(404, 'NOT_FOUND', 'This blog is not available.');
    return this.intel.read(s.userId, s.role, slug);
  }

  @Put('blogs/:id/reaction')
  @HttpCode(200)
  react(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.intel.react(s.userId, id, true);
  }

  @Delete('blogs/:id/reaction')
  @HttpCode(200)
  unreact(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.intel.react(s.userId, id, false);
  }

  @Post('blogs/:id/comments')
  @HttpCode(201)
  comment(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CommentDto, @CurrentSession() s: Session) {
    return this.intel.comment(s.userId, id, dto.body);
  }

  @Post('reports')
  @HttpCode(201)
  report(@Body() dto: ReportDto, @CurrentSession() s: Session) {
    if (!dto.blogId === !dto.commentId)
      throw new AppError(400, 'VALIDATION_FAILED', 'Report one blog or one comment.', { field: 'blogId' });
    return this.intel.report(s.userId, { blogId: dto.blogId, commentId: dto.commentId }, dto.reason);
  }
}

/** A student's own blogs: drafts, edits, sending for review. */
@ApiTags('student: intel')
@Controller('student/blogs')
@Roles('student')
export class StudentBlogsController {
  constructor(private readonly intel: IntelService) {}

  @Get()
  mine(@CurrentSession() s: Session) {
    return this.intel.mine(s.userId);
  }

  @Post()
  create(@Body() dto: BlogDto, @CurrentSession() s: Session) {
    return this.intel.create(s.userId, dto);
  }

  @Patch(':id')
  edit(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: BlogPatchDto, @CurrentSession() s: Session) {
    return this.intel.edit(s.userId, id, dto);
  }

  @Post(':id/submit')
  @HttpCode(200)
  submit(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SubmitBlogDto, @CurrentSession() s: Session) {
    return this.intel.submit(s.userId, id, dto.ownWork);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    await this.intel.removeDraft(s.userId, id);
  }
}

/** Admin LMS → Intel moderation (permission `blogs.moderate`). */
@ApiTags('admin: intel')
@Controller('admin')
@Roles('admin')
export class AdminIntelController {
  constructor(private readonly intel: IntelService) {}

  @Get('blogs')
  @RequirePermission('blogs.moderate')
  queue(@Query() q: QueueQuery) {
    return this.intel.queue(q.status ?? 'in_review');
  }

  @Get('blogs/counts')
  @RequirePermission('blogs.moderate')
  counts() {
    return this.intel.queueCounts();
  }

  @Get('blogs/:id/history')
  @RequirePermission('blogs.moderate')
  history(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.intel.history(id);
  }

  @Post('blogs/:id/decision')
  @RequirePermission('blogs.moderate', 'Y')
  @HttpCode(200)
  decide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecisionDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.intel.decide(actorOf(s, req), id, dto.decision, dto.note);
  }

  @Post('blogs/:id/unpublish')
  @RequirePermission('blogs.moderate', 'Y')
  @RequireReason()
  @HttpCode(200)
  unpublish(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.intel.unpublish(actorOf(s, req), id, dto.reason);
  }

  @Post('comments/:id/hide')
  @RequirePermission('blogs.moderate', 'Y')
  @RequireReason()
  @HttpCode(200)
  hide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.intel.hideComment(actorOf(s, req), id, dto.reason);
  }

  @Get('content-reports')
  @RequirePermission('blogs.moderate')
  reports() {
    return this.intel.reports();
  }

  @Post('content-reports/:id/resolve')
  @RequirePermission('blogs.moderate', 'Y')
  @RequireReason()
  @HttpCode(200)
  resolve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.intel.resolveReport(actorOf(s, req), id, dto.reason);
  }
}
