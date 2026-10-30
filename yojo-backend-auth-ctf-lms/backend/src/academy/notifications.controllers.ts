import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { Audience, CurrentSession, RequirePermission, Roles } from '../common/decorators/auth.decorators';
import { AppError } from '../common/errors/app-error';
import { RateLimitService } from '../common/guards/rate-limit.service';
import type { AppRequest } from '../common/http/request-context';
import { metaOf } from '../identity/http';
import { NotificationsService } from './notifications.service';

type Session = NonNullable<AppRequest['session']>;

class ListQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unread?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() before?: string;
}
class PrefDto {
  @ApiProperty() @IsBoolean() emailImportant!: boolean;
}
class BroadcastDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() batchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allStudents?: boolean;
  @ApiProperty() @IsString() @Length(3, 150) title!: string;
  @ApiProperty() @IsString() @Length(1, 2000) body!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() important?: boolean;
}
const MESSAGE_CATEGORIES = ['fee_dues', 'attendance', 'academic', 'general'] as const;
class DirectMessageDto {
  @ApiProperty() @IsUUID() studentId!: string;
  @ApiProperty({ enum: MESSAGE_CATEGORIES }) @IsIn(MESSAGE_CATEGORIES) category!: (typeof MESSAGE_CATEGORIES)[number];
  @ApiProperty() @IsString() @Length(3, 150) title!: string;
  @ApiProperty() @IsString() @Length(1, 2000) body!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() important?: boolean;
}
class AssistantDto {
  @ApiProperty() @IsString() @Length(1, 2000) message!: string;
}

/** The bell, for any signed-in Academy user (own notifications only). */
@ApiTags('me: notifications')
@Controller('me/notifications')
@Audience('any')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@Query() q: ListQuery, @CurrentSession() s: Session) {
    return this.svc.list(s.userId, q);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.svc.read(s.userId, id);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentSession() s: Session) {
    return this.svc.readAll(s.userId);
  }

  @Get('preferences')
  prefs(@CurrentSession() s: Session) {
    return this.svc.preferences(s.userId);
  }

  @Put('preferences')
  setPrefs(@Body() dto: PrefDto, @CurrentSession() s: Session) {
    return this.svc.preferences(s.userId, dto.emailImportant);
  }
}

@ApiTags('admin: notifications')
@Controller('admin/notifications')
@Roles('admin')
export class AdminNotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Post('broadcast')
  @RequirePermission('broadcast', 'Y')
  @HttpCode(201)
  broadcast(@Body() dto: BroadcastDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.broadcast({ userId: s.userId, ...metaOf(req) }, dto);
  }

  /** One student (owner, 30 Oct): fee dues, attendance, academic or general. */
  @Post('direct')
  @RequirePermission('broadcast', 'Y')
  @HttpCode(201)
  direct(@Body() dto: DirectMessageDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.direct({ userId: s.userId, ...metaOf(req) }, dto);
  }

  @Get('direct')
  @RequirePermission('broadcast')
  directHistory() {
    return this.svc.directHistory();
  }
}

/**
 * Orbi assistant boundary. No assistant service exists in this project, so the API says so instead of producing
 * scripted answers that look like AI. When a provider is chosen, this is where it plugs in (with the student's
 * rate limit and only the student's own non-sensitive context; prompts are not logged).
 */
@ApiTags('student: assistant')
@Controller('student/assistant')
@Roles('student')
export class AssistantController {
  constructor(private readonly rate: RateLimitService) {}

  @Get()
  status() {
    return {
      available: false,
      reason: 'ASSISTANT_NOT_CONFIGURED',
      message: 'Orbi chat is not connected to an assistant service yet.',
    };
  }

  @Post('messages')
  async ask(@Body() _dto: AssistantDto, @CurrentSession() s: Session): Promise<never> {
    await this.rate.hitClass('message_user', s.userId);
    throw new AppError(
      503,
      'ASSISTANT_NOT_CONFIGURED',
      'Orbi chat is not connected to an assistant service yet. Your trainer can help in Messages.',
    );
  }
}

class AnnouncementDto {
  @ApiProperty() @IsString() @Length(3, 150) title!: string;
  @ApiProperty() @IsString() @Length(1, 2000) body!: string;
}

/** Trainer console → Messages → "Post to batch" (restored 29 Oct). */
@ApiTags('trainer: messages')
@Controller('trainer')
@Roles('trainer')
export class TrainerAnnouncementsController {
  constructor(private readonly notes: NotificationsService) {}

  @Get('announcements')
  list(@CurrentSession() s: Session) {
    return this.notes.announcements(s.userId);
  }

  @Post('batches/:id/announcements')
  post(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AnnouncementDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.notes.announce({ userId: s.userId, ...metaOf(req) }, id, dto);
  }
}

/** Student LMS → My Handler → Trainer announcements. */
@ApiTags('student: lms')
@Controller('student')
@Roles('student')
export class StudentAnnouncementsController {
  constructor(private readonly notes: NotificationsService) {}

  @Get('announcements')
  list(@CurrentSession() s: Session) {
    return this.notes.studentAnnouncements(s.userId);
  }
}
