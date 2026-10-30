import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsUUID,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateInviteDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty({ enum: ['trainer', 'admin'] }) @IsIn(['trainer', 'admin']) role!: 'trainer' | 'admin';
  @ApiPropertyOptional({ enum: ['platform'] })
  @ValidateIf((o: CreateInviteDto) => o.role === 'admin')
  @IsIn(['platform'])
  adminRole?: 'platform';
  @ApiPropertyOptional({ enum: ['trainer', 'trainer_mentor'] })
  @ValidateIf((o: CreateInviteDto) => o.role === 'trainer')
  @IsIn(['trainer', 'trainer_mentor'])
  capability?: 'trainer' | 'trainer_mentor';
  @ApiPropertyOptional({ type: [String], description: 'Trainer invites only: batches the trainer will lead' })
  @ValidateIf((o: CreateInviteDto) => o.role === 'trainer' && o.batchIds !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  batchIds?: string[];
}

/** The invitee email comes from the stored request; role fields are needed only to approve. */
export class DecideAccessRequestDto {
  @ApiProperty({ enum: ['approve', 'decline'] }) @IsIn(['approve', 'decline']) decision!: 'approve' | 'decline';
  @ApiPropertyOptional({ enum: ['trainer', 'admin'] })
  @ValidateIf((o: DecideAccessRequestDto) => o.decision === 'approve')
  @IsIn(['trainer', 'admin'])
  role?: 'trainer' | 'admin';
  @ApiPropertyOptional({ enum: ['platform'] })
  @IsOptional()
  @IsIn(['platform'])
  adminRole?: 'platform';
  @ApiPropertyOptional({ enum: ['trainer', 'trainer_mentor'] })
  @IsOptional()
  @IsIn(['trainer', 'trainer_mentor'])
  capability?: 'trainer' | 'trainer_mentor';
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(5) @MaxLength(500) reason?: string;
}

export class StaffStatusDto {
  @ApiProperty({ enum: ['active', 'suspended'] }) @IsIn(['active', 'suspended']) status!: 'active' | 'suspended';
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(5) @MaxLength(500) reason?: string;
}

export class StaffRoleDto {
  @ApiPropertyOptional({ enum: ['platform'] })
  @IsOptional()
  @IsIn(['platform'])
  adminRole?: 'platform';
  @ApiPropertyOptional({ enum: ['trainer', 'trainer_mentor'] })
  @IsOptional()
  @IsIn(['trainer', 'trainer_mentor'])
  capability?: 'trainer' | 'trainer_mentor';
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(5) @MaxLength(500) reason?: string;
}

export class DualControlDecisionDto {
  @ApiProperty({ enum: ['confirm', 'reject'] }) @IsIn(['confirm', 'reject']) decision!: 'confirm' | 'reject';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}
