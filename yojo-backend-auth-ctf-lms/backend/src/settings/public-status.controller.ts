import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/auth.decorators';
import { SettingsService } from './settings.service';

@ApiTags('public')
@Controller('public')
export class PublicStatusController {
  constructor(private readonly settings: SettingsService) {}

  /** Maintenance banner for every front end (spec §8.2). */
  @Get('status')
  @Public()
  async status() {
    const { value } = await this.settings.get('maintenance');
    return { maintenance: value.enabled, message: value.enabled ? value.message : null };
  }
}
