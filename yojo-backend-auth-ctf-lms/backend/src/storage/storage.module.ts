import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/** File storage for the whole app (local disk in development; an object store for production, OI-45). */
@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
