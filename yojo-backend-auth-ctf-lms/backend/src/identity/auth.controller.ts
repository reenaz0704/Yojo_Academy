import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { randomToken } from '../common/crypto/crypto.util';
import {
  AllowOnboarding,
  Audience,
  CurrentSession,
  Public,
  RateLimit,
  Roles,
  StepUp,
} from '../common/decorators/auth.decorators';
import type { AppRequest } from '../common/http/request-context';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { AccountService } from './account.service';
import { clearSessionCookies, cookieNames, setPreSessionCsrf } from './cookies';
import {
  AccessRequestDto,
  ChangePasswordDto,
  CodeDto,
  ForgotPasswordDto,
  GoogleDto,
  InviteAcceptDto,
  MfaReenrolDto,
  PolicyDto,
  ResetPasswordDto,
  SendOtpDto,
  SignupDto,
  StaffLoginDto,
  StaffTotpDto,
  TrainerProfileDto,
  VerifyOtpDto,
} from './dto/auth.dto';
import { metaOf, sendSession } from './http';
import { StaffAuthService } from './staff-auth.service';
import { StudentAuthService, type StudentSignInResult } from './student-auth.service';

type Session = NonNullable<AppRequest['session']>;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly students: StudentAuthService,
    private readonly staff: StaffAuthService,
    private readonly account: AccountService,
  ) {}

  /** CSRF token for the current session, or a pre-session token (double submit) before sign-in. */
  @Get('csrf')
  @Public()
  csrf(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    if (req.session) return { csrfToken: req.session.csrf };
    const existing = (req.cookies as Record<string, string> | undefined)?.[cookieNames(this.cfg).csrf];
    const token = existing && /^[\w-]{20,64}$/.test(existing) ? existing : randomToken(24);
    setPreSessionCsrf(res, this.cfg, token);
    return { csrfToken: token };
  }

  // ── Students ──
  @Post('student/otp')
  @Public()
  @HttpCode(202)
  @RateLimit('otp_send_ip')
  sendOtp(@Body() dto: SendOtpDto) {
    return this.students.sendOtp(dto);
  }

  @Post('student/verify')
  @Public()
  @HttpCode(200)
  @RateLimit('otp_verify_ip')
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    return this.studentResult(await this.students.verifyOtp(dto.challengeId, dto.code, metaOf(req), dto.gate), res);
  }

  @Post('google')
  @Public()
  @HttpCode(200)
  @RateLimit('otp_verify_ip')
  async google(@Body() dto: GoogleDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    return this.studentResult(await this.students.google(dto.idToken, dto.gate, metaOf(req)), res);
  }

  @Post('signup')
  @Public()
  @HttpCode(201)
  @RateLimit('otp_verify_ip')
  async signup(@Body() dto: SignupDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    return { next: 'done', ...sendSession(res, this.cfg, await this.students.signup(dto, metaOf(req))) };
  }

  // ── Staff sign-in ──
  @Post('staff/login')
  @Public()
  @HttpCode(200)
  @RateLimit('staff_login_ip')
  async staffLogin(@Body() dto: StaffLoginDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.staff.passwordStep(dto.email, dto.password, metaOf(req));
    if (r.next === 'totp') return r;
    return {
      next: 'onboarding',
      ...sendSession(res, this.cfg, r.session),
      onboarding: await this.staff.onboardingState(r.session.data.userId),
    };
  }

  @Post('staff/totp')
  @Public()
  @HttpCode(200)
  @RateLimit('staff_login_ip')
  async staffTotp(@Body() dto: StaffTotpDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const s = await this.staff.totpStep(dto.challengeId, dto.code, dto.recoveryCode, metaOf(req));
    return { next: s.data.scope === 'full' ? 'done' : 'onboarding', ...sendSession(res, this.cfg, s) };
  }

  @Post('invite/accept')
  @Public()
  @HttpCode(200)
  @RateLimit('staff_login_ip')
  async acceptInvite(@Body() dto: InviteAcceptDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.staff.acceptInvite(dto.token, dto.password, metaOf(req));
    return { next: 'onboarding', ...sendSession(res, this.cfg, r.session), onboarding: r.onboarding };
  }

  @Post('staff/mfa-reenrol')
  @Public()
  @HttpCode(200)
  @RateLimit('staff_login_ip')
  async mfaReenrol(@Body() dto: MfaReenrolDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.staff.mfaReenrol(dto.token, dto.password, metaOf(req));
    return { next: 'onboarding', ...sendSession(res, this.cfg, r.session), onboarding: r.onboarding };
  }

  // ── Staff onboarding (session scope "onboarding") ──
  @Get('staff/onboarding')
  @Roles('admin', 'trainer')
  @AllowOnboarding()
  onboarding(@CurrentSession() s: Session) {
    return this.staff.onboardingState(s.userId);
  }

  @Post('staff/mfa-setup')
  @Roles('admin', 'trainer')
  @AllowOnboarding()
  @HttpCode(200)
  mfaSetup(@CurrentSession() s: Session) {
    return this.staff.mfaSetup(s.userId);
  }

  @Post('staff/mfa-confirm')
  @Roles('admin', 'trainer')
  @AllowOnboarding()
  @HttpCode(200)
  async mfaConfirm(
    @Body() dto: CodeDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.staff.mfaConfirm(s, dto.code, metaOf(req));
    return {
      recoveryCodes: r.recoveryCodes,
      onboarding: r.onboarding,
      ...(r.session ? sendSession(res, this.cfg, r.session) : {}),
    };
  }

  @Post('staff/policy')
  @Roles('admin', 'trainer')
  @AllowOnboarding()
  @HttpCode(200)
  async policy(
    @Body() dto: PolicyDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.staff.acceptPolicy(s, dto, metaOf(req));
    return { onboarding: r.onboarding, ...(r.session ? sendSession(res, this.cfg, r.session) : {}) };
  }

  @Post('staff/profile')
  @Roles('trainer')
  @AllowOnboarding()
  @HttpCode(200)
  async profile(
    @Body() dto: TrainerProfileDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.staff.trainerProfile(s, s.role, dto, metaOf(req));
    return { onboarding: r.onboarding, ...(r.session ? sendSession(res, this.cfg, r.session) : {}) };
  }

  @Post('staff/access-request')
  @Public()
  @HttpCode(202)
  @RateLimit('access_request_ip')
  async accessRequest(@Body() dto: AccessRequestDto, @Req() req: AppRequest) {
    await this.staff.accessRequest(dto, metaOf(req));
    return { status: 'received' };
  }

  // ── Step-up and passwords ──
  @Post('step-up')
  @Roles('admin', 'trainer')
  @HttpCode(200)
  async stepUp(
    @Body() dto: CodeDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const issued = await this.account.stepUp(s, dto.code, metaOf(req));
    return { stepUpUntil: new Date(Date.now() + 300_000).toISOString(), ...sendSession(res, this.cfg, issued) };
  }

  @Post('password')
  @Roles('admin', 'trainer')
  @StepUp('fresh')
  @HttpCode(204)
  async changePassword(@Body() dto: ChangePasswordDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    await this.staff.changePassword(s, dto.currentPassword, dto.newPassword, metaOf(req));
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(202)
  @RateLimit('password_forgot_ip')
  forgot(@Body() dto: ForgotPasswordDto, @Req() req: AppRequest) {
    // Not awaited on purpose: same response time whether or not the account exists.
    void this.staff.forgotPassword(dto.email, metaOf(req));
    return { status: 'sent_if_account_exists' };
  }

  @Post('password/reset')
  @Public()
  @HttpCode(204)
  @RateLimit('password_forgot_ip')
  async reset(@Body() dto: ResetPasswordDto, @Req() req: AppRequest) {
    await this.staff.resetPassword(dto.token, dto.newPassword, dto.code, dto.recoveryCode, metaOf(req));
  }

  // ── Sessions ──
  @Post('logout')
  @Audience('any')
  @AllowOnboarding()
  @HttpCode(204)
  async logout(@CurrentSession() s: Session, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.account.logout(s, metaOf(req));
    clearSessionCookies(res, this.cfg);
  }

  @Post('logout-all')
  @Audience('any')
  @AllowOnboarding()
  @HttpCode(200)
  async logoutAll(@CurrentSession() s: Session, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const revoked = await this.account.logoutAll(s, metaOf(req));
    clearSessionCookies(res, this.cfg);
    return { revoked };
  }

  @Get('sessions')
  @Audience('any')
  async sessions(@CurrentSession() s: Session) {
    return { items: await this.account.listSessions(s) };
  }

  @Delete('sessions/:id')
  @Audience('any')
  @HttpCode(204)
  async revoke(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    await this.account.revokeSession(s, id, metaOf(req));
  }

  private studentResult(r: StudentSignInResult, res: Response) {
    if (r.next === 'signup') return r;
    return { next: 'done', ...sendSession(res, this.cfg, r.session) };
  }
}
