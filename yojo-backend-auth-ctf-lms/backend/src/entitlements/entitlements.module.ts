import { Global, Module } from '@nestjs/common';
import { EntitlementService } from './entitlement.service';
import { EntitlementsController } from './entitlements.controller';

@Global()
@Module({
  providers: [EntitlementService],
  controllers: [EntitlementsController],
  exports: [EntitlementService],
})
export class EntitlementsModule {}
