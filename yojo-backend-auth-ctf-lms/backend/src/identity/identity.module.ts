import { Global, Module } from '@nestjs/common';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service';
import { RateLimitService } from '../common/guards/rate-limit.service';
import { AccountService } from './account.service';
import { AuthController } from './auth.controller';
import { GoogleVerifier } from './google.verifier';
import { LoginService } from './login.service';
import { MailModule } from './mail/mail.module';
import { MeController } from './me.controller';
import { MfaService } from './mfa.service';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { StaffAdminController } from './staff-admin.controller';
import { StaffAdminService } from './staff-admin.service';
import { StaffAuthService } from './staff-auth.service';
import { StudentAuthService } from './student-auth.service';

@Global()
@Module({
  imports: [MailModule],
  providers: [
    FieldEncryptionService,
    RateLimitService,
    PasswordService,
    SessionService,
    OtpService,
    MfaService,
    GoogleVerifier,
    LoginService,
    StudentAuthService,
    StaffAuthService,
    AccountService,
    StaffAdminService,
  ],
  controllers: [AuthController, MeController, StaffAdminController],
  exports: [
    FieldEncryptionService,
    RateLimitService,
    PasswordService,
    SessionService,
    MfaService,
    OtpService,
    LoginService,
  ],
})
export class IdentityModule {}
