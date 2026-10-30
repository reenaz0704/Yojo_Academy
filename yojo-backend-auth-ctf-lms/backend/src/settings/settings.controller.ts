import { Body, Controller, Get, Headers, Param, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsObject } from 'class-validator';
import { CurrentSession, RequirePermission, Roles } from '../common/decorators/auth.decorators';
import { AppError } from '../common/errors/app-error';
import type { AppRequest } from '../common/http/request-context';
import { MfaService } from '../identity/mfa.service';
import { SettingsService } from './settings.service';
import { STEP_UP_SECTIONS } from './settings.schemas';

class PutSettingsDto {
  @IsObject() value!: Record<string, unknown>;
}

type Session = NonNullable<AppRequest['session']>;

@ApiTags('settings')
@Controller('admin/settings')
@Roles('admin')
@RequirePermission('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly mfa: MfaService,
  ) {}

  @Get()
  async list(@CurrentSession() s: Session) {
    const sections = this.settings.editableBy(s.adminRole!);
    const out: Record<string, unknown> = {};
    for (const sec of sections) out[sec] = await this.settings.get(sec);
    return { sections: out };
  }

  @Get(':section')
  async one(@Param('section') section: string, @CurrentSession() s: Session) {
    this.settings.assertEditable(s.adminRole!, section);
    return this.settings.get(section);
  }

  @Get(':section/history')
  async history(@Param('section') section: string, @CurrentSession() s: Session) {
    this.settings.assertEditable(s.adminRole!, section);
    return { items: await this.settings.history(section) };
  }

  @Put(':section')
  async put(
    @Param('section') section: string,
    @Body() body: PutSettingsDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('x-step-up-code') stepUpCode: string | undefined,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    this.settings.assertEditable(s.adminRole!, section);
    if (!ifMatch || !/^"?\d+"?$/.test(ifMatch))
      throw new AppError(428, 'IF_MATCH_REQUIRED', 'Send If-Match with the version you are editing.');
    if (STEP_UP_SECTIONS.includes(section)) await this.mfa.requireFreshCode(s.userId, stepUpCode);
    return this.settings.update(section, body.value, Number(ifMatch.replace(/"/g, '')), {
      userId: s.userId,
      adminRole: s.adminRole!,
      ip: req.ip,
      requestId: String(req.id),
    });
  }
}
