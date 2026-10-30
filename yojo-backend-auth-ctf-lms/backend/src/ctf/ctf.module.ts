import { Module } from '@nestjs/common';
import { CtfAuthService } from './ctf-auth.service';
import { CtfController } from './ctf.controller';

@Module({ providers: [CtfAuthService], controllers: [CtfController] })
export class CtfModule {}
