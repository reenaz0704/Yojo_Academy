import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const SUBMISSION_TYPES = [
  'contact',
  'mentorship_session',
  'internship_application',
  'course_enrolment',
] as const;
export const SUBMISSION_STATUSES = [
  'new',
  'reviewing',
  'assigned',
  'in_progress',
  'waiting_for_user',
  'resolved',
  'closed',
  'rejected',
] as const;
export const CONTENT_KINDS = ['faq', 'testimonial', 'mentor', 'post'] as const;
export const CONTENT_STATUSES = ['draft', 'published', 'archived'] as const;

// ── Public ──

/**
 * Every public form posts this shape. The union of all form fields is declared here (so unknown fields are refused by
 * the global pipe); SubmissionsService then refuses fields the chosen `type` does not have (SUBMISSION_RULES).
 */
export class CreateSubmissionDto {
  @ApiProperty({ enum: SUBMISSION_TYPES }) @IsIn(SUBMISSION_TYPES) type!: (typeof SUBMISSION_TYPES)[number];
  @ApiPropertyOptional({ example: 'Sai Teja' }) @IsOptional() @IsString() @Length(2, 100) name?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email?: string;
  @ApiPropertyOptional({ example: '+91 98765 43210' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
  @ApiPropertyOptional({ description: 'Contact topic, mentorship path, internship squad, or course title' })
  @IsOptional()
  @IsString()
  @Length(2, 150)
  topic?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) message?: string;
  @ApiPropertyOptional({ description: 'Mentorship only: preferred date and time (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  preferredAt?: string;
  @ApiPropertyOptional({ description: 'Must be true on the anonymous forms ("I agree to be contacted")' })
  @IsOptional()
  @IsBoolean()
  consent?: boolean;
  @ApiPropertyOptional({ example: 'index.html#contact' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourcePage?: string;
  /** Honeypot: a hidden field people never see. Anything in it means a bot filled the form. */
  @ApiPropertyOptional({ description: 'Leave empty (spam trap)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

export class EventReminderDto {
  @ApiProperty() @IsEmail({}, { message: 'Enter a valid email address.' }) @MaxLength(254) email!: string;
  @ApiProperty({ description: 'Must be true: "Email me about this event"' })
  @Equals(true, { message: 'Tick the box so we may email you about this event.' })
  consent!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) website?: string;
}

export class UnsubscribeDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[\w-]{20,100}$/, { message: 'This unsubscribe link is not valid.' })
  token!: string;
}

export class ContentQuery {
  @ApiProperty({ enum: CONTENT_KINDS }) @IsIn(CONTENT_KINDS) kind!: (typeof CONTENT_KINDS)[number];
}

// ── Admin: submissions ──

export class SubmissionListQuery {
  @ApiPropertyOptional({ enum: SUBMISSION_TYPES })
  @IsOptional()
  @IsIn(SUBMISSION_TYPES)
  type?: (typeof SUBMISSION_TYPES)[number];
  @ApiPropertyOptional({ enum: [...SUBMISSION_STATUSES, 'open'] })
  @IsOptional()
  @IsIn([...SUBMISSION_STATUSES, 'open'])
  status?: (typeof SUBMISSION_STATUSES)[number] | 'open';
  @ApiPropertyOptional({ description: '"me", "none" (unassigned) or a staff user id' })
  @IsOptional()
  @Matches(/^(me|none|[0-9a-f-]{36})$/)
  assignee?: string;
  @ApiPropertyOptional({ description: 'Reference (ENQ-1001), or part of a name, email or phone' })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  q?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: ['created_desc', 'created_asc', 'updated_desc'] })
  @IsOptional()
  @IsIn(['created_desc', 'created_asc', 'updated_desc'])
  sort?: 'created_desc' | 'created_asc' | 'updated_desc';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class MetricsQuery {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

export class AssignDto {
  @ApiProperty({ nullable: true, description: 'Staff user id, or null to unassign' })
  @IsOptional()
  @IsUUID()
  assigneeId!: string | null;
}

export class StatusDto {
  @ApiProperty({ enum: SUBMISSION_STATUSES }) @IsIn(SUBMISSION_STATUSES) status!: (typeof SUBMISSION_STATUSES)[number];
  @ApiProperty({
    enum: SUBMISSION_STATUSES,
    description: 'The status you saw; the change fails if someone moved it since',
  })
  @IsIn(SUBMISSION_STATUSES)
  from!: (typeof SUBMISSION_STATUSES)[number];
  @ApiPropertyOptional({ description: 'Required when closing, resolving, rejecting or reopening' })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason?: string;
}

export class NoteDto {
  @ApiProperty() @IsString() @Length(1, 2000) body!: string;
}

export class ContactAttemptDto {
  @ApiProperty({ enum: ['phone', 'email', 'whatsapp', 'other'] })
  @IsIn(['phone', 'email', 'whatsapp', 'other'])
  channel!: 'phone' | 'email' | 'whatsapp' | 'other';
  @ApiProperty({ enum: ['reached', 'no_answer', 'left_message', 'wrong_number', 'bounced'] })
  @IsIn(['reached', 'no_answer', 'left_message', 'wrong_number', 'bounced'])
  outcome!: 'reached' | 'no_answer' | 'left_message' | 'wrong_number' | 'bounced';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

// ── Admin: content ──

export class ContentListQuery {
  @ApiPropertyOptional({ enum: CONTENT_KINDS })
  @IsOptional()
  @IsIn(CONTENT_KINDS)
  kind?: (typeof CONTENT_KINDS)[number];
  @ApiPropertyOptional({ enum: CONTENT_STATUSES })
  @IsOptional()
  @IsIn(CONTENT_STATUSES)
  status?: (typeof CONTENT_STATUSES)[number];
}

export class ContentCreateDto {
  @ApiProperty({ enum: CONTENT_KINDS }) @IsIn(CONTENT_KINDS) kind!: (typeof CONTENT_KINDS)[number];
  @ApiPropertyOptional({ description: 'Lower-case letters, digits and dashes; made from the title when left out' })
  @IsOptional()
  @Matches(/^[a-z0-9][a-z0-9-]{0,79}$/, { message: 'Use lower-case letters, digits and dashes.' })
  slug?: string;
  @ApiProperty() @IsString() @Length(1, 200) title!: string;
  @ApiPropertyOptional({ description: 'Plain text; blank lines separate paragraphs' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  body?: string;
  @ApiPropertyOptional({ description: 'Kind-specific fields (see PublicContentService.DATA_RULES)' })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}

export class ContentPatchDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z0-9][a-z0-9-]{0,79}$/) slug?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) body?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() data?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}

// ── Admin: events ──

export class EventPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() listed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) summary?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(720) durationHours?: number;
  @ApiPropertyOptional({ example: 'Teams 1-3' }) @IsOptional() @IsString() @MaxLength(40) format?: string;
}

export class EventCreateDto extends EventPatchDto {
  @ApiProperty() @IsString() @Length(2, 100) declare name: string;
  @ApiProperty({ example: 'web-breakers-sprint' })
  @Matches(/^[a-z0-9][a-z0-9-]{1,59}$/, { message: 'Use lower-case letters, digits and dashes.' })
  slug!: string;
}

export class IdListDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) ids!: string[];
}
