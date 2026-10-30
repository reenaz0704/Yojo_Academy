import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentSession } from '../common/decorators/auth.decorators';
import type { AppRequest } from '../common/http/request-context';
import { AccountService } from './account.service';
import { UpdateMeDto } from './dto/auth.dto';
import { metaOf } from './http';

type Session = NonNullable<AppRequest['session']>;

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly account: AccountService) {}

  @Get()
  me(@CurrentSession() s: Session) {
    return this.account.me(s);
  }

  @Patch()
  update(@Body() dto: UpdateMeDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.account.updateMe(s, dto, metaOf(req));
  }

  @Get('missing-fields')
  missing(@CurrentSession() s: Session) {
    return this.account.missingFields(s);
  }
}
