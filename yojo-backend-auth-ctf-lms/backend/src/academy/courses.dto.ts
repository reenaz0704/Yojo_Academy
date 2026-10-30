import { ApiProperty, ApiPropertyOptional, IntersectionType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { COURSE_FILTERS } from './courses.service';

const LESSON_TYPES = ['video', 'document', 'slides', 'concept', 'quiz', 'lab', 'live_class', 'resource'] as const;

export class CatalogQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) category?: string;
  @ApiPropertyOptional({ enum: COURSE_FILTERS })
  @IsOptional()
  @IsIn(COURSE_FILTERS)
  filter?: (typeof COURSE_FILTERS)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) q?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) cursor?: string;
}

export class StudentCoursesQuery {
  @ApiPropertyOptional({ enum: ['all', 'mine', 'pending'] }) @IsOptional() @IsIn(['all', 'mine', 'pending']) view?:
    | 'all'
    | 'mine'
    | 'pending';
}

export class CoursePatchDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z0-9][a-z0-9-]{1,79}$/) slug?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 150) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400) summary?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) overview?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) level?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) duration?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  format?: string[];
  @ApiPropertyOptional({ enum: ['free', 'paid'] }) @IsOptional() @IsIn(['free', 'paid']) access?: 'free' | 'paid';
  @ApiPropertyOptional() @IsOptional() @IsBoolean() featured?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  outcomes?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) prerequisites?: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o: CoursePatchDto) => o.prerequisiteCourseId !== null)
  @IsUUID()
  prerequisiteCourseId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) audience?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  labs?: string[];
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o: CoursePatchDto) => o.certificate !== null)
  @IsString()
  @Length(2, 120)
  certificate?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^(https:\/\/|assets\/)[^\s"'<>]{1,300}$/, { message: 'Use an https URL or an assets/ path.' })
  imageUrl?: string;
  @ApiPropertyOptional({ nullable: true, description: 'Published price in paise; null = on request' })
  @IsOptional()
  @ValidateIf((o: CoursePatchDto) => o.pricePaise !== null)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  pricePaise?: number | null;
}

export class CourseDto extends CoursePatchDto {
  @ApiProperty({ example: 'C-SOC' }) @Matches(/^[A-Z0-9][A-Z0-9-]{1,23}$/) code!: string;
  @ApiProperty({ example: 'soc-analyst' }) @Matches(/^[a-z0-9][a-z0-9-]{1,79}$/) declare slug: string;
  @ApiProperty() @IsString() @Length(2, 150) declare title: string;
  @ApiProperty() @IsString() @Length(2, 80) declare category: string;
}

export class CourseStatusDto {
  @ApiProperty({ enum: ['draft', 'published', 'unpublished', 'archived'] })
  @IsIn(['draft', 'published', 'unpublished', 'archived'])
  status!: 'draft' | 'published' | 'unpublished' | 'archived';
}

export class CourseStatusQuery {
  @ApiPropertyOptional({ enum: ['draft', 'published', 'unpublished', 'archived'] })
  @IsOptional()
  @IsIn(['draft', 'published', 'unpublished', 'archived'])
  status?: 'draft' | 'published' | 'unpublished' | 'archived';
}

export class ModuleDto {
  @ApiProperty() @IsString() @Length(2, 150) title!: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}
export class ModulePatchDto extends PartialType(ModuleDto) {}

export class LessonPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 200) title?: string;
  @ApiPropertyOptional({ enum: LESSON_TYPES }) @IsOptional() @IsIn(LESSON_TYPES) type?: (typeof LESSON_TYPES)[number];
  @ApiPropertyOptional({ enum: ['draft', 'published'] }) @IsOptional() @IsIn(['draft', 'published']) status?:
    | 'draft'
    | 'published';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() preview?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;
  @ApiPropertyOptional({ enum: ['manual', 'quiz_pass', 'lab_cleared'] })
  @IsOptional()
  @IsIn(['manual', 'quiz_pass', 'lab_cleared'])
  completion?: 'manual' | 'quiz_pass' | 'lab_cleared';
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Za-z0-9_-]{2,40}$/) refCode?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^https:\/\/[^\s"'<>]{1,500}$/, { message: 'Use an https link.' })
  contentUrl?: string;
  @ApiPropertyOptional({ description: 'Plain text; shown escaped' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  body?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) fileName?: string;
  /** An uploaded file of the same course (trainer console, 29 Oct); null detaches it. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o: LessonPatchDto) => o.fileId !== null)
  @IsUUID()
  fileId?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5000)
  fileSizeMb?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() downloadable?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) durationMin?: number;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o: LessonPatchDto) => o.releaseAt !== null)
  @IsISO8601()
  releaseAt?: string | null;
}

export class LessonDto extends LessonPatchDto {
  @ApiProperty() @IsString() @Length(2, 200) declare title: string;
  @ApiProperty({ enum: LESSON_TYPES }) @IsIn(LESSON_TYPES) declare type: (typeof LESSON_TYPES)[number];
}

export class FaqDto {
  @ApiProperty() @IsString() @Length(5, 300) question!: string;
  @ApiProperty() @IsString() @Length(2, 3000) answer!: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() published?: boolean;
}
export class FaqPatchDto extends PartialType(FaqDto) {}

/** Why a trainer edits or deletes course content (OI-48, owner 24 Oct). "other" needs a written note. */
export const CHANGE_REASONS = ['content_correction', 'outdated', 'duplicate', 'restructure', 'other'] as const;
export type ChangeReasonCode = (typeof CHANGE_REASONS)[number];
export const CHANGE_REASON_LABELS: Record<ChangeReasonCode, string> = {
  content_correction: 'Content correction',
  outdated: 'Outdated content',
  duplicate: 'Duplicate',
  restructure: 'Restructuring the course',
  other: 'Other',
};

export class ChangeReasonDto {
  @ApiProperty({ enum: CHANGE_REASONS })
  @IsIn(CHANGE_REASONS, { message: 'Choose a reason for this change.' })
  reasonCode!: ChangeReasonCode;
  @ApiPropertyOptional({ description: 'Required when the reason is "other"' })
  @ValidateIf((o: ChangeReasonDto) => o.reasonCode === 'other' || o.reasonNote !== undefined)
  @IsString()
  @Length(5, 500, { message: 'Describe the reason in 5 to 500 characters.' })
  reasonNote?: string;
}
export class TrainerModulePatchDto extends IntersectionType(ModulePatchDto, ChangeReasonDto) {}
export class TrainerLessonPatchDto extends IntersectionType(LessonPatchDto, ChangeReasonDto) {}
export class TrainerFaqPatchDto extends IntersectionType(FaqPatchDto, ChangeReasonDto) {}

export class IssueCertificateDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsUUID() courseId!: string;
}

export class RevokeDto {
  @ApiProperty() @IsString() @Length(5, 500) reason!: string;
}

/* ---------- trainer course builder (owner, 29 Oct) ---------- */

/** Course tracks shown in the trainer console, and the catalog category each one maps to. */
export const TRACKS = {
  Defensive: 'Defensive Security and SOC',
  Offensive: 'Offensive Security and Ethical Hacking',
  GRC: 'Governance, Risk and Compliance (GRC)',
  Foundations: 'Cybersecurity Fundamentals',
} as const;
export type Track = keyof typeof TRACKS;
const TRACK_KEYS = Object.keys(TRACKS) as Track[];
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const;

/** A reason is optional on an add, but required once the course is published (checked in the service, OI-48). */
export class OptionalReasonDto {
  @ApiPropertyOptional({ enum: CHANGE_REASONS })
  @IsOptional()
  @IsIn(CHANGE_REASONS, { message: 'Choose a reason for this change.' })
  reasonCode?: ChangeReasonCode;
  @ApiPropertyOptional()
  @ValidateIf((o: OptionalReasonDto) => o.reasonCode === 'other' || o.reasonNote !== undefined)
  @IsString()
  @Length(5, 500, { message: 'Describe the reason in 5 to 500 characters.' })
  reasonNote?: string;
}
export class TrainerModuleDto extends IntersectionType(ModuleDto, OptionalReasonDto) {}
export class TrainerLessonDto extends IntersectionType(LessonDto, OptionalReasonDto) {}
export class TrainerFaqDto extends IntersectionType(FaqDto, OptionalReasonDto) {}

export class TrainerCourseFieldsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 150) title?: string;
  @ApiPropertyOptional({ enum: TRACK_KEYS }) @IsOptional() @IsIn(TRACK_KEYS) track?: Track;
  @ApiPropertyOptional({ enum: LEVELS }) @IsOptional() @IsIn(LEVELS) level?: (typeof LEVELS)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) duration?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400) summary?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  outcomes?: string[];
}
export class TrainerCourseCreateDto extends TrainerCourseFieldsDto {
  @ApiProperty() @IsString() @Length(2, 150) declare title: string;
  @ApiProperty({ enum: TRACK_KEYS }) @IsIn(TRACK_KEYS) declare track: Track;
  @ApiPropertyOptional({ description: 'Batches you lead or co-lead that should run this course' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  batchIds?: string[];
}
export class TrainerCoursePatchDto extends IntersectionType(TrainerCourseFieldsDto, OptionalReasonDto) {}
export class TrainerBatchesDto {
  @ApiProperty() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) batchIds!: string[];
}
export class CoEditorDto {
  @ApiProperty() @IsString() @Length(3, 254) email!: string;
}
export class CourseChangeDecisionDto {
  @ApiProperty() @IsBoolean() approve!: boolean;
  @ApiPropertyOptional({ description: 'Required when rejecting; shown to the trainer' })
  @ValidateIf((o: CourseChangeDecisionDto) => !o.approve || o.note !== undefined)
  @IsString()
  @Length(5, 500, { message: 'Write a note of 5 to 500 characters for the trainer.' })
  note?: string;
}
export class CourseChangeQuery {
  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected'] })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: 'pending' | 'approved' | 'rejected';
}
