import { Global, Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { PublicStatusController } from './public-status.controller';

@Global()
@Module({
  providers: [SettingsService],
  controllers: [SettingsController, PublicStatusController],
  exports: [SettingsService],
})
export class SettingsModule {}
