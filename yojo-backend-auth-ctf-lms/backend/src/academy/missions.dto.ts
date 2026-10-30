import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const CODE = /^[A-Z0-9][A-Z0-9-]{1,23}$/;

export class MissionQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 60) q?: string;
}

export class QuizStepDto {
  @ApiProperty({ type: [Number], description: 'One option index per question, in order' })
  @IsArray()
  @ArrayMaxSize(30)
  @IsInt({ each: true })
  answers!: number[];
}

export class AnswerStepDto {
  @ApiProperty() @IsString() @Length(1, 500) answer!: string;
}

export class FlagDto {
  @ApiProperty() @IsString() @Length(1, 200) flag!: string;
}

export class MissionPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 150) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 40) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) difficulty?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) estMinutes?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) xpReward?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() premium?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @Matches(CODE, { each: true })
  prerequisites?: string[];
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z]{2,20}$/) cityCode?: string;
  @ApiPropertyOptional({ enum: ['native', 'mission-api'] })
  @IsOptional()
  @IsIn(['native', 'mission-api'])
  provider?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z0-9-]{1,20}$/) providerSlug?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) maxSubmissions?: number;
  @ApiPropertyOptional({ enum: ['draft', 'published', 'retired'] })
  @IsOptional()
  @IsIn(['draft', 'published', 'retired'])
  status?: 'draft' | 'published' | 'retired';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class MissionDto extends MissionPatchDto {
  @ApiProperty({ example: 'OFF-01' }) @Matches(CODE) code!: string;
  @ApiProperty() @IsString() @Length(2, 150) declare title: string;
  @ApiProperty() @IsString() @Length(2, 40) declare category: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) declare xpReward: number;
}

export class HintDto {
  @ApiProperty({ minimum: 1, maximum: 3 }) @Type(() => Number) @IsInt() @Min(1) @Max(3) n!: number;
  @ApiProperty() @IsString() @Length(2, 1000) text!: string;
}
