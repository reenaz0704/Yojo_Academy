import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentSession, RequireEntitlement, Roles } from '../common/decorators/auth.decorators';
import type { AppRequest } from '../common/http/request-context';
import { EntitlementService, PAID_KEY } from './entitlement.service';

type Session = NonNullable<AppRequest['session']>;

@ApiTags('entitlements')
@Controller()
@Roles('student')
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementService) {}

  /** What this student may open, computed on the server. The front end uses it only to show or hide links. */
  @Get('me/entitlements')
  mine(@CurrentSession() s: Session) {
    return this.entitlements.listKeys(s.userId);
  }

  /** Integration hook for paid content routes: answers 200 only with a live paid entitlement. */
  @Get('learn/paid/access')
  @RequireEntitlement(PAID_KEY)
  paidAccess() {
    return { access: true, entitlement: PAID_KEY };
  }
}
