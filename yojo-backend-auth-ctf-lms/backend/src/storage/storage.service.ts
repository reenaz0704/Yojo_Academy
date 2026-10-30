import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';

/** Where uploaded bytes live. Production needs an object store with signed URLs and malware scanning (OI-45). */
export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Buffer): Promise<void>;
  open(key: string): Promise<{ stream: Readable; size: number }>;
  remove(key: string): Promise<void>;
}

/**
 * Development driver: a private folder outside the web root (never served directly; files go out only through
 * authorised API routes). Keys are server-generated UUID paths, so a client can never pick a path.
 */
class LocalDiskDriver implements StorageDriver {
  readonly name = 'local-disk';
  constructor(private readonly root: string) {}

  private path(key: string) {
    if (!/^[a-z0-9/-]{8,200}$/.test(key) || key.includes('..')) throw new Error('Bad storage key.');
    return join(this.root, ...key.split('/'));
  }
  async put(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(resolve(p, '..'), { recursive: true });
    await writeFile(p, data, { flag: 'wx' }); // never overwrite
  }
  async open(key: string) {
    const p = this.path(key);
    const s = await stat(p);
    return { stream: createReadStream(p), size: s.size };
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
}

@Injectable()
export class StorageService {
  private readonly driver: StorageDriver | null;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    const env = cfg.APP_ENV;
    // Local disk only outside production-like environments; staging/production wait for the object store (OI-45).
    const allowed = process.env.NODE_ENV !== 'production' && ['local', 'development', 'test'].includes(env);
    const root =
      env === 'test'
        ? join(tmpdir(), 'yojo-test-storage')
        : resolve(process.env.STORAGE_LOCAL_DIR || join(process.cwd(), '.local-storage'));
    this.driver = allowed ? new LocalDiskDriver(root) : null;
  }

  get available() {
    return !!this.driver;
  }

  /** The driver, or 503 STORAGE_NOT_CONFIGURED when no storage provider is connected (OI-45). */
  use(): StorageDriver {
    if (!this.driver)
      throw new AppError(503, 'STORAGE_NOT_CONFIGURED', 'File storage is not connected yet (OPEN-ITEMS OI-45).');
    return this.driver;
  }
}
