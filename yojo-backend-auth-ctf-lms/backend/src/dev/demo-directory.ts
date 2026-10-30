import { Body, Controller, Get, HttpCode, Inject, Module, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Public, RateLimit } from '../common/decorators/auth.decorators';
import type { AppRequest } from '../common/http/request-context';
import { AppError } from '../common/errors/app-error';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { metaOf, sendSession } from '../identity/http';
import { IdentityModule } from '../identity/identity.module';
import { LoginService } from '../identity/login.service';
import { MAIL_PORT, type MailPort } from '../identity/mail/mail.port';
import { MfaService } from '../identity/mfa.service';
import { OtpService } from '../identity/otp.service';
import { normEmail } from '../identity/types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * LOCAL DEVELOPMENT ONLY (owner's request, 29 Oct; OI-63). The sign-in page's "Demo accounts & inbox" panel, as it
 * was in the prototype, but against the real server: the demo people (Riya and Neha, existing Yojo students; Arjun,
 * a new student who signs up with "No"; Vikram, trainer; Priya, Platform Admin), the codes emailed to *.demo
 * addresses (read from the dev mail folder) and, for the two demo staff, the shared demo password and authenticator
 * keys so the panel can show their current codes. Created by scripts/dev-demo-users.ts. The route answers 404
 * unless APP_ENV is local or development, so none of this exists on a staging or production server.
 */
export const DEMO_STAFF_PASSWORD = 'Yojo@Demo2026';
export const DEMO_PEOPLE = [
  {
    email: 'riya.sharma@students.yojo.demo',
    name: 'Riya Sharma',
    role: 'student',
    note: 'Yojo student (Yes) · profile complete · path Defensive',
    studentNumber: 'U-20417',
  },
  {
    email: 'neha.p@students.yojo.demo',
    name: 'Neha P',
    role: 'student',
    note: 'Yojo student (Yes) · profile complete · no path yet (career quiz)',
    studentNumber: 'U-20419',
  },
  {
    email: 'arjun.k@students.yojo.demo',
    name: 'Arjun K',
    role: 'student',
    note: 'New student (No) · sign up, then profile and career quiz',
    studentNumber: null,
  },
  {
    email: 'trainer@yojo.demo',
    name: 'Vikram Rao (Trainer)',
    role: 'trainer',
    note: 'Trainer + Mentor',
    totpSecret: 'JBSWY3DPEHPK3PXP',
  },
  {
    email: 'platform.admin@yojo.demo',
    name: 'Priya (Platform Admin)',
    role: 'admin',
    note: 'Platform Admin',
    totpSecret: 'GEZDGNBVGY3TQOJQ',
  },
] as const;

export const demoDirectoryAllowed = (cfg: Pick<AppConfig, 'APP_ENV' | 'NODE_ENV'>) =>
  cfg.NODE_ENV !== 'production' && (cfg.APP_ENV === 'local' || cfg.APP_ENV === 'development');

/** Only demo addresses (ending in .demo) are ever shown, never a real person's code. */
const isDemoAddress = (to: unknown) => typeof to === 'string' && /@([a-z0-9-]+\.)*demo$/i.test(to.trim());

@ApiExcludeController()
@Controller('dev')
export class DevDemoController {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  @Get('demo')
  @Public()
  demo() {
    if (!demoDirectoryAllowed(this.cfg)) throw new AppError(404, 'NOT_FOUND', 'Not found.');
    return {
      enabled: true,
      staffPassword: DEMO_STAFF_PASSWORD,
      accounts: DEMO_PEOPLE,
      inbox: this.inbox(),
      note: 'Local development only. Codes for *.demo addresses come from the dev mail folder.',
    };
  }

  private inbox() {
    const dir = this.cfg.DEV_MAIL_DIR;
    if (!dir) return [];
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
    return files
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(0, 60)
      .map(({ f, t }) => {
        try {
          const m = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { to?: string; subject?: string; text?: string };
          if (!isDemoAddress(m.to)) return null;
          const text = m.text ?? '';
          return {
            to: m.to,
            subject: m.subject ?? '',
            code: /\b(\d{6})\b/.exec(text)?.[1] ?? null,
            link: /(https?:\/\/\S+)/.exec(text)?.[1] ?? null,
            at: new Date(t).toISOString(),
          };
        } catch {
          return null;
        }
      })
      .filter((x) => x !== null)
      .slice(0, 12);
  }
}

class StaffOtpDto {
  @IsEmail() @MaxLength(254) email!: string;
}
class StaffVerifyDto {
  @IsString() @Length(10, 80) challengeId!: string;
  @Matches(/^\d{6}$/) code!: string;
  @Matches(/^\d{6}$/) totp!: string;
}
const DEMO_STAFF = DEMO_PEOPLE.filter((p) => p.role !== 'student').map((p) => p.email) as string[];
const PURPOSE = 'demo-staff';

/**
 * The prototype's staff sign-in (organisation email → email code → authenticator code), LOCAL DEVELOPMENT ONLY and
 * only for the two demo staff (Vikram, Priya). Real staff always sign in with password + authenticator; on staging
 * and production these routes answer 404. The email code goes through the normal OTP service and dev mail folder,
 * and the authenticator code is checked against the stored factor, exactly like a real sign-in.
 */
@ApiExcludeController()
@Controller('dev/demo/staff')
export class DevDemoStaffController {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly mfa: MfaService,
    private readonly login: LoginService,
  ) {}

  private guard(email: string) {
    if (!demoDirectoryAllowed(this.cfg) || !DEMO_STAFF.includes(email))
      throw new AppError(404, 'NOT_FOUND', 'Not found.');
  }

  @Post('otp')
  @Public()
  @HttpCode(200)
  @RateLimit('staff_login_ip')
  async send(@Body() dto: StaffOtpDto) {
    const email = normEmail(dto.email);
    this.guard(email);
    const r = await this.otp.issue(email, PURPOSE);
    await this.mail.send({
      to: email,
      template: 'otp',
      subject: 'Your Yojo staff sign-in code',
      text: `Your Yojo staff sign-in code is ${r.code}. It expires in ${Math.round(r.ttlSec / 60)} minutes.`,
    });
    return { challengeId: r.challengeId, expiresInSec: r.ttlSec, resendAfterSec: r.resendSec };
  }

  @Post('verify')
  @Public()
  @HttpCode(200)
  @RateLimit('staff_login_ip')
  async verify(@Body() dto: StaffVerifyDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    if (!demoDirectoryAllowed(this.cfg)) throw new AppError(404, 'NOT_FOUND', 'Not found.');
    const email = await this.otp.verify(dto.challengeId, dto.code, PURPOSE);
    this.guard(email);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { email } });
    this.login.assertCanSignIn(user);
    if (!(await this.mfa.verifyTotp(user.id, dto.totp)))
      throw new AppError(401, 'TOTP_INVALID', 'That authenticator code is not right.');
    const s = await this.login.start(user, 'full', metaOf(req), 'auth.demo.staff_login', {
      detail: { method: 'otp+totp' },
    });
    return { next: 'done', ...sendSession(res, this.cfg, s) };
  }
}

@Module({ imports: [IdentityModule], controllers: [DevDemoController, DevDemoStaffController] })
export class DevDemoModule {}
