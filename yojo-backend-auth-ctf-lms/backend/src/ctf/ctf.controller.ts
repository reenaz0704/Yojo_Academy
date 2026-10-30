import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Audience, CurrentSession, Public, RateLimit } from '../common/decorators/auth.decorators';
import type { AppRequest } from '../common/http/request-context';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { metaOf, sendSession } from '../identity/http';
import { CtfAuthService, type CtfResult } from './ctf-auth.service';
import {
  CtfCodeDto,
  CtfForgotDto,
  CtfLoginDto,
  CtfLoginOtpDto,
  CtfLoginTotpDto,
  CtfOtpDto,
  CtfRegisterDto,
  CtfResetDto,
} from './ctf.dto';

type Session = NonNullable<AppRequest['session']>;

@ApiTags('ctf')
@Controller('ctf')
@Audience('ctf')
export class CtfController {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly ctf: CtfAuthService,
  ) {}

  @Post('register/otp')
  @Public()
  @HttpCode(202)
  @RateLimit('otp_send_ip')
  registerOtp(@Body() dto: CtfOtpDto) {
    return this.ctf.sendRegisterOtp(dto.email);
  }

  @Post('register')
  @Public()
  @HttpCode(201)
  @RateLimit('ctf_register_ip')
  async register(@Body() dto: CtfRegisterDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    return this.done(await this.ctf.register(dto, metaOf(req)), res);
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @RateLimit('ctf_login_ip')
  login(@Body() dto: CtfLoginDto, @Req() req: AppRequest) {
    return this.ctf.passwordStep(dto.username, dto.password, dto.next, metaOf(req));
  }

  @Post('login/otp')
  @Public()
  @HttpCode(200)
  @RateLimit('otp_verify_ip')
  async loginOtp(@Body() dto: CtfLoginOtpDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.ctf.otpStep(dto.challengeId, dto.code, metaOf(req));
    return r.next === 'totp' ? r : this.done(r, res);
  }

  @Post('login/totp')
  @Public()
  @HttpCode(200)
  @RateLimit('ctf_login_ip')
  async loginTotp(@Body() dto: CtfLoginTotpDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    return this.done(await this.ctf.totpStep(dto.ticket, dto.code, dto.recoveryCode, metaOf(req)), res);
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(202)
  @RateLimit('password_forgot_ip')
  forgot(@Body() dto: CtfForgotDto, @Req() req: AppRequest) {
    void this.ctf.forgotPassword(dto.usernameOrEmail, metaOf(req));
    return { status: 'sent_if_account_exists' };
  }

  @Post('password/reset')
  @Public()
  @HttpCode(204)
  @RateLimit('password_forgot_ip')
  async reset(@Body() dto: CtfResetDto, @Req() req: AppRequest) {
    await this.ctf.resetPassword(dto.token, dto.newPassword, dto.code, metaOf(req));
  }

  @Get('me')
  me(@CurrentSession() s: Session) {
    return this.ctf.me(s.userId);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@CurrentSession() s: Session) {
    return this.ctf.mfaSetup(s.userId);
  }

  @Post('mfa/confirm')
  @HttpCode(200)
  mfaConfirm(@Body() dto: CtfCodeDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.ctf.mfaConfirm(s.userId, dto.code, metaOf(req));
  }

  private done(r: CtfResult, res: Response) {
    const { session, ...rest } = r;
    return { ...rest, ...sendSession(res, this.cfg, session) };
  }
}
