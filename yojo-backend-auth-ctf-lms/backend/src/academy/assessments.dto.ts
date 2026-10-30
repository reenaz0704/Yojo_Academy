import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const KINDS = ['quiz', 'assignment', 'lab_challenge', 'practical', 'exam'] as const;
const FORMATS = ['questions', 'text', 'file', 'lab_result'] as const;
const RELEASE = ['immediate', 'after_due', 'manual'] as const;

export class AssessmentListQuery {
  @ApiPropertyOptional({ enum: ['all', 'pending', 'due_soon', 'submitted', 'completed', 'missed'] })
  @IsOptional()
  @IsIn(['all', 'pending', 'due_soon', 'submitted', 'completed', 'missed'])
  status?: string;
}

export class SubmitDto {
  @ApiPropertyOptional({ description: 'Quiz: { questionId: optionIndex | optionIndex[] | text }' })
  @IsOptional()
  @IsObject()
  answers?: Record<string, number | number[] | string>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20_000) text?: string;
  @ApiPropertyOptional({ description: 'Lab code you cleared (verified on the server)' })
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{2,40}$/)
  labRef?: string;
}

export class AssessmentPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 150) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) instructions?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) difficulty?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(600) durationMin?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsISO8601() opensAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsISO8601() dueAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) maxMarks?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) passMarks?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) attemptsAllowed?: number;
  @ApiPropertyOptional({ enum: FORMATS }) @IsOptional() @IsIn(FORMATS) format?: (typeof FORMATS)[number];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowLate?: boolean;
  @ApiPropertyOptional({ enum: RELEASE }) @IsOptional() @IsIn(RELEASE) resultsRelease?: (typeof RELEASE)[number];
}

export class AssessmentDto extends AssessmentPatchDto {
  @ApiProperty({ example: 'Q-SOC-3' }) @Matches(/^[A-Za-z0-9_-]{2,40}$/) code!: string;
  @ApiProperty() @IsUUID() courseId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() batchId?: string;
  @ApiProperty() @IsString() @Length(2, 150) declare title: string;
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS) kind!: (typeof KINDS)[number];
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(1000) declare maxMarks: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(1000) declare passMarks: number;
  @ApiProperty({ enum: FORMATS }) @IsIn(FORMATS) declare format: (typeof FORMATS)[number];
  @ApiPropertyOptional({ description: 'Quiz only (default true)' }) @IsOptional() @IsBoolean() autoGrade?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsObject() rubric?: Record<string, unknown>;
}

export class AssessmentStatusDto {
  @ApiProperty({ enum: ['draft', 'published', 'closed'] }) @IsIn(['draft', 'published', 'closed']) status!:
    | 'draft'
    | 'published'
    | 'closed';
}

export class QuestionDto {
  @ApiProperty({ enum: ['single', 'multi', 'short_text'] }) @IsIn(['single', 'multi', 'short_text']) kind!:
    | 'single'
    | 'multi'
    | 'short_text';
  @ApiProperty() @IsString() @Length(2, 2000) prompt!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  options?: string[];
  @ApiProperty({ description: 'single: option index; multi: indexes; short_text: accepted answers' })
  @IsDefined()
  answerKey!: number | number[] | string[];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) marks?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}

export class GradeDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(1000) score!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) feedback?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() rubricScores?: Record<string, unknown>;
  @ApiPropertyOptional({ description: 'Send back for another try' })
  @IsOptional()
  @IsBoolean()
  returnForRevision?: boolean;
  @ApiPropertyOptional({ description: 'Required when changing an existing mark' })
  @IsOptional()
  @IsString()
  @Length(5, 300)
  reason?: string;
}

export class ExtensionDto {
  @ApiProperty() @IsUUID() studentId!: string;
  @ApiProperty() @IsISO8601() dueAt!: string;
  @ApiProperty() @IsString() @Length(5, 300) reason!: string;
}
