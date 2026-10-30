import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEmail,
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
  MinLength,
  ValidateIf,
} from 'class-validator';

export const USER_VIEWS = [
  'all',
  'students',
  'free',
  'paid',
  'ctf',
  'trainers',
  'admins',
  'pending_verification',
  'pending_onboarding',
  'invited',
  'suspended',
] as const;
export type UserView = (typeof USER_VIEWS)[number];
export const USER_SORTS = ['created_desc', 'created_asc', 'name_asc', 'last_login_desc'] as const;
export type UserSort = (typeof USER_SORTS)[number];

export class UserListQuery {
  @ApiPropertyOptional({ enum: USER_VIEWS }) @IsOptional() @IsIn(USER_VIEWS) view?: UserView;
  @ApiPropertyOptional({ description: 'Search email, name, user code or student ID' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional({ enum: USER_SORTS }) @IsOptional() @IsIn(USER_SORTS) sort?: UserSort;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ProvisionStudentDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty() @IsString() @Length(2, 100) name!: string;
  @ApiPropertyOptional({ example: 'YS-24-0193' })
  @IsOptional()
  @Matches(/^[A-Za-z0-9-]{3,30}$/)
  studentNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() institutionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 150) institutionName?: string;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class GrantEntitlementDto {
  @ApiProperty({ example: 'plan:paid' }) @Matches(/^[a-z0-9:_-]{3,60}$/) key!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class ReasonOnlyDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class UserStatusDto {
  @ApiProperty({ enum: ['active', 'suspended'] }) @IsIn(['active', 'suspended']) status!: 'active' | 'suspended';
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class BatchDto {
  @ApiProperty({ example: 'B-2026-07' }) @Matches(/^[A-Za-z0-9-]{2,30}$/) code!: string;
  @ApiPropertyOptional({ description: 'The course this batch runs; enrolment opens it' })
  @IsOptional()
  @IsUUID()
  courseId?: string;
  @ApiProperty() @IsString() @Length(2, 120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() trainerId?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  coTrainerIds?: string[];
  @ApiPropertyOptional({ enum: ['online', 'offline', 'hybrid'] })
  @IsOptional()
  @IsIn(['online', 'offline', 'hybrid'])
  mode?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional({ enum: ['planned', 'active', 'completed', 'cancelled'] })
  @IsOptional()
  @IsIn(['planned', 'active', 'completed', 'cancelled'])
  status?: 'planned' | 'active' | 'completed' | 'cancelled';
}

export class BatchPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) name?: string;
  @ApiPropertyOptional({ nullable: true, description: 'The course this batch runs' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  courseId?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  trainerId?: string | null;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  coTrainerIds?: string[];
  @ApiPropertyOptional({ enum: ['online', 'offline', 'hybrid'] })
  @IsOptional()
  @IsIn(['online', 'offline', 'hybrid'])
  mode?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional({ enum: ['planned', 'active', 'completed', 'cancelled'] })
  @IsOptional()
  @IsIn(['planned', 'active', 'completed', 'cancelled'])
  status?: 'planned' | 'active' | 'completed' | 'cancelled';
}

export class EnrolDto {
  @ApiProperty() @IsUUID() batchId!: string;
}
