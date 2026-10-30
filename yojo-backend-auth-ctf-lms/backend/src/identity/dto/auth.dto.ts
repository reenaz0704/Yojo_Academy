import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class SendOtpDto {
  @ApiPropertyOptional({ example: 'asha@abc-institute.demo', description: 'Required unless identifier is given' })
  @ValidateIf((o: SendOtpDto) => !o.identifier)
  @IsEmail()
  @MaxLength(254)
  email?: string;
  @ApiPropertyOptional({
    example: 'YS-24-0193',
    description: 'YES path only: Yojo email or Yojo student ID. The code goes to the email on file.',
  })
  @IsOptional()
  @IsString()
  @Length(3, 254)
  identifier?: string;
  @ApiPropertyOptional({ enum: ['login', 'signup'] }) @IsOptional() @IsIn(['login', 'signup']) purpose?:
    | 'login'
    | 'signup';
  @ApiPropertyOptional({
    enum: ['yojo', 'open'],
    description: 'yojo = "Are you a Yojo student?" YES (never creates an account); open = NO path (sign up or log in)',
  })
  @IsOptional()
  @IsIn(['yojo', 'open'])
  gate?: 'yojo' | 'open';
}

export class VerifyOtpDto {
  @ApiProperty() @IsString() @Length(4, 40) challengeId!: string;
  @ApiProperty({ example: '482913' }) @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code.' }) code!: string;
  @ApiPropertyOptional({ enum: ['yojo', 'open'] }) @IsOptional() @IsIn(['yojo', 'open']) gate?: 'yojo' | 'open';
}

export class ConsentsDto {
  @ApiProperty() @IsBoolean() terms!: boolean;
  @ApiProperty() @IsBoolean() privacy!: boolean;
  @ApiProperty() @IsBoolean() aup!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() marketing?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() parental?: boolean;
}

export class GuardianDto {
  @ApiProperty() @IsString() @Length(2, 100) name!: string;
  @ApiProperty() @IsString() @Length(2, 40) relation!: string;
  @ApiProperty() @Matches(/^\+?[0-9 ]{8,16}$/, { message: 'Enter a valid phone number.' }) phone!: string;
}

export class SignupDto {
  @ApiProperty() @IsString() @Length(10, 80) signupTicket!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() institutionId?: string;
  @ApiProperty() @IsString() @Length(2, 100) name!: string;
  @ApiPropertyOptional({
    description: 'Free-text institution when it is not in the list (one of institutionId or this)',
  })
  @ValidateIf((o: SignupDto) => !o.institutionId)
  @IsString()
  @Length(2, 150)
  institutionName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) city?: string;
  @ApiPropertyOptional({ example: '2008-05-14' }) @IsOptional() @IsDateString() dob?: string;
  @ApiProperty({ type: ConsentsDto }) @ValidateNested() @Type(() => ConsentsDto) consents!: ConsentsDto;
  @ApiPropertyOptional({ type: GuardianDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GuardianDto)
  guardian?: GuardianDto;
}

export class GoogleDto {
  @ApiProperty() @IsString() @Length(20, 4096) idToken!: string;
  @ApiProperty({ enum: ['yojo', 'open'], description: 'yojo = "Are you a Yojo student?" YES path' })
  @IsIn(['yojo', 'open'])
  gate!: 'yojo' | 'open';
}

export class StaffLoginDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty() @IsString() @Length(1, 128) password!: string;
}

export class StaffTotpDto {
  @ApiProperty() @IsString() @Length(4, 60) challengeId!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{6}$/) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(6, 20) recoveryCode?: string;
}

export class InviteAcceptDto {
  @ApiProperty() @IsString() @Length(20, 100) token!: string;
  @ApiProperty() @IsString() @Length(10, 128) password!: string;
}

export class MfaReenrolDto {
  @ApiProperty() @IsString() @Length(20, 100) token!: string;
  @ApiProperty() @IsString() @Length(1, 128) password!: string;
}

export class CodeDto {
  @ApiProperty() @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code.' }) code!: string;
}

export class PolicyDto {
  @ApiProperty() @IsString() codeOfConductVersion!: string;
  @ApiProperty() @IsString() dataHandlingVersion!: string;
}

export class TrainerProfileDto {
  @ApiProperty() @IsString() @Length(2, 60) displayName!: string;
  @ApiProperty() @IsString() @Length(2, 120) speciality!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  certifications?: string[];
  @ApiPropertyOptional() @IsOptional() @IsObject() availability?: Record<string, unknown>;
}

export class AccessRequestDto {
  @ApiProperty() @IsString() @Length(2, 100) name!: string;
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty() @IsString() @Length(2, 60) role!: string;
  @ApiProperty() @IsString() @Length(5, 500) reason!: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @Length(1, 128) currentPassword!: string;
  @ApiProperty() @IsString() @Length(10, 128) newPassword!: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @Length(20, 100) token!: string;
  @ApiProperty() @IsString() @Length(10, 128) newPassword!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{6}$/) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(6, 20) recoveryCode?: string;
}

export class UpdateMeDto {
  @IsOptional() @IsString() @Length(2, 100) name?: string;
  @IsOptional() @IsString() @Length(2, 40) displayName?: string;
  @IsOptional() @Matches(/^\+?[0-9 ]{8,16}$/) phone?: string;
  @IsOptional() @IsDateString() dob?: string;
  @IsOptional() @IsString() @Length(2, 80) city?: string;
  @IsOptional() @IsString() @Length(2, 60) eduLevel?: string;
  @IsOptional() @IsString() @Length(2, 80) stream?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1990) @Max(2040) gradYear?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10) cgpa?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(60, { each: true }) skills?: string[];
  @IsOptional() @IsString() @MaxLength(600) objective?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  certifications?: string[];
  @IsOptional() @IsBoolean() showOnBoard?: boolean;
  @IsOptional() @ValidateNested() @Type(() => GuardianDto) guardian?: GuardianDto;
  // staff fields
  @IsOptional() @IsString() @Length(2, 80) title?: string;
  @IsOptional() @IsString() @Length(2, 120) speciality?: string;
  @IsOptional() @IsString() @MaxLength(1000) bio?: string;
  @IsOptional()
  @Matches(/^https:\/\/([a-z]+\.)?linkedin\.com\//, { message: 'Use an https LinkedIn address.' })
  linkedinUrl?: string;
}

export class ReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(5) @MaxLength(500) reason?: string;
}
