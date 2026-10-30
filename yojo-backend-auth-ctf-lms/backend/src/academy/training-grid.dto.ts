import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SESSION_TYPES = ['class', 'lab', 'mentor', 'quiz'] as const;

export class RangeQuery {
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @Matches(DAY) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @Matches(DAY) to?: string;
}

export class WeekQuery {
  @ApiPropertyOptional({ example: '2026-10-19', description: 'Any day of the week (IST)' })
  @IsOptional()
  @Matches(DAY)
  week?: string;
}

export class BookDto {
  @ApiProperty() @IsUUID() slotId!: string;
  @ApiProperty({ enum: ['doubt', 'mentoring', 'mock_interview'] })
  @IsIn(['doubt', 'mentoring', 'mock_interview'])
  purpose!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RespondDto {
  @ApiProperty() @IsBoolean() accept!: boolean;
}

export class LeaveDto {
  @ApiProperty({ example: '2026-11-03' }) @Matches(DAY) from!: string;
  @ApiProperty({ example: '2026-11-04' }) @Matches(DAY) to!: string;
  @ApiProperty() @IsString() @Length(5, 500) reason!: string;
}

export class StartConversationDto {
  @ApiProperty() @IsUUID() staffId!: string;
  @ApiProperty() @IsString() @Length(1, 150) subject!: string;
  @ApiProperty() @IsString() @Length(1, 4000) body!: string;
}

export class MessageDto {
  @ApiProperty() @IsString() @Length(1, 4000) body!: string;
}

export class SessionDto {
  @ApiProperty() @IsUUID() batchId!: string;
  @ApiProperty({ enum: SESSION_TYPES }) @IsIn(SESSION_TYPES) type!: (typeof SESSION_TYPES)[number];
  @ApiProperty() @IsString() @Length(2, 150) title!: string;
  @ApiProperty() @IsISO8601() startsAt!: string;
  @ApiProperty() @IsISO8601() endsAt!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^https:\/\/[^\s"'<>]{1,500}$/, { message: 'Use an https meeting link.' })
  joinUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) room?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() countsForAttendance?: boolean;
}

export class SessionPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 150) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() endsAt?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^(https:\/\/[^\s"'<>]{1,500})?$/) joinUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) room?: string;
  @ApiPropertyOptional({ description: 'Cancels the session' })
  @IsOptional()
  @IsString()
  @Length(5, 300)
  cancelReason?: string;
}

export class MarkDto {
  @ApiProperty() @IsUUID() studentId!: string;
  @ApiProperty({ enum: ['present', 'absent', 'late', 'excused'] })
  @IsIn(['present', 'absent', 'late', 'excused'])
  mark!: 'present' | 'absent' | 'late' | 'excused';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class MarksDto {
  @ApiProperty({ type: [MarkDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => MarkDto)
  marks!: MarkDto[];
  @ApiPropertyOptional({ description: 'Required when an existing mark changes' })
  @IsOptional()
  @IsString()
  @Length(5, 300)
  reason?: string;
}

export class SlotDto {
  @ApiProperty() @IsISO8601() startsAt!: string;
  @ApiProperty() @IsISO8601() endsAt!: string;
  @ApiPropertyOptional({ enum: ['one_to_one', 'mock_interview'] })
  @IsOptional()
  @IsIn(['one_to_one', 'mock_interview'])
  kind?: string;
}

export class DecideRequestDto {
  @ApiProperty({ enum: ['approve', 'reject', 'propose'] }) @IsIn(['approve', 'reject', 'propose']) decision!:
    | 'approve'
    | 'reject'
    | 'propose';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() proposedStart?: string;
}

export class DecideLeaveDto {
  @ApiProperty() @IsBoolean() approve!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class HolidayDto {
  @ApiProperty({ example: '2026-11-09' }) @Matches(DAY) day!: string;
  @ApiProperty() @IsString() @Length(2, 80) name!: string;
}

export class VerifyCredentialsDto {
  @ApiProperty() @IsBoolean() verified!: boolean;
}

export class BatchReportQuery extends RangeQuery {
  @ApiProperty() @IsUUID() batchId!: string;
}
