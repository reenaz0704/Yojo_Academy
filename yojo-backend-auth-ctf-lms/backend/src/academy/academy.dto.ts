import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';

export class StreakDecisionDto {
  @ApiProperty() @IsUUID() breakId!: string;
  @ApiProperty({ enum: ['keep', 'reset'] }) @IsIn(['keep', 'reset']) decision!: 'keep' | 'reset';
}

export class OnboardingDto {
  @ApiProperty({ description: 'One entry per question: option index, 1..5 for scale items, or "skip"', type: [Object] })
  @IsArray()
  @ArrayMinSize(18)
  @ArrayMaxSize(18)
  answers!: (number | 'skip')[];
}

export class LeaderboardQuery {
  @ApiPropertyOptional({ enum: ['week', 'all', 'college'] }) @IsOptional() @IsIn(['week', 'all', 'college']) tab?:
    | 'week'
    | 'all'
    | 'college';
}

export class XpCorrectionDto {
  @ApiProperty({ description: 'Positive or negative whole number' })
  @Type(() => Number)
  @IsInt()
  @Min(-100_000)
  @Max(100_000)
  @NotEquals(0)
  delta!: number;
  @ApiProperty() @IsString() @Length(5, 300) reason!: string;
}

export class LedgerQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() before?: string;
}

export class CloseWeekDto {
  @ApiProperty({ example: '2026-10-19', description: 'Monday (IST) of the week to close' })
  @IsString()
  @Length(10, 10)
  week!: string;
}

export class CareerQuizDto {
  @ApiProperty({ description: 'One option id per question, in question order (15)', type: [String] })
  @IsArray()
  @ArrayMinSize(15)
  @ArrayMaxSize(15)
  @IsString({ each: true })
  @MaxLength(4, { each: true })
  answers!: string[];
}

export class CareerPathDto {
  @ApiProperty({ enum: ['Offensive', 'Defensive', 'GRC'] }) @IsIn(['Offensive', 'Defensive', 'GRC']) path!:
    | 'Offensive'
    | 'Defensive'
    | 'GRC';
}
