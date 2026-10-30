import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;

export class CtfOtpDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
}

export class CtfConsentsDto {
  @ApiProperty({ description: 'Must be true: CTF rules and code of conduct' })
  @Equals(true, { message: 'Accept the CTF rules to continue.' })
  ctf_rules!: boolean;
  @ApiProperty({ description: 'May Yojo contact you about CTF events (true or false)' })
  @IsBoolean()
  ctf_contact!: boolean;
}

export class CtfRegisterDto {
  @ApiProperty() @IsString() @Length(4, 60) challengeId!: string;
  @ApiProperty() @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code.' }) code!: string;
  @ApiProperty({ example: 'asha_h4x' })
  @Matches(USERNAME_RE, { message: 'Use 3 to 24 letters, numbers or underscores.' })
  username!: string;
  @ApiProperty() @IsString() @Length(10, 128) password!: string;
  @ApiProperty({ type: CtfConsentsDto }) @ValidateNested() @Type(() => CtfConsentsDto) consents!: CtfConsentsDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 60) event?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\+?[0-9 ]{8,16}$/) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 150) institution?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) city?: string;
  @ApiPropertyOptional({ enum: ['beginner', 'intermediate', 'advanced'] })
  @IsOptional()
  @IsIn(['beginner', 'intermediate', 'advanced'])
  level?: string;
}

export class CtfLoginDto {
  @ApiProperty() @IsString() @Length(1, 64) username!: string;
  @ApiProperty() @IsString() @Length(1, 128) password!: string;
  @ApiPropertyOptional({ description: 'Where to go after sign-in; only allow-listed CTF paths are honoured' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  next?: string;
}

export class CtfLoginOtpDto {
  @ApiProperty() @IsString() @Length(4, 60) challengeId!: string;
  @ApiProperty() @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code.' }) code!: string;
}

export class CtfLoginTotpDto {
  @ApiProperty() @IsString() @Length(10, 80) ticket!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{6}$/) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(6, 20) recoveryCode?: string;
}

export class CtfCodeDto {
  @ApiProperty() @Matches(/^\d{6}$/) code!: string;
}

export class CtfForgotDto {
  @ApiProperty() @IsString() @Length(3, 254) usernameOrEmail!: string;
}

export class CtfResetDto {
  @ApiProperty() @IsString() @Length(20, 100) token!: string;
  @ApiProperty() @IsString() @Length(10, 128) newPassword!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{6}$/) code?: string;
}
