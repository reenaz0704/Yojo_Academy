import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/config.schema';

/**
 * AES-256-GCM envelope for secrets stored in the database (MFA secrets now; join links and lab secrets later).
 * Layout: 12-byte IV | 16-byte tag | ciphertext. The key ID is stored next to the ciphertext so keys can rotate.
 * Production: the key comes from the secrets manager / KMS data key (spec §22.2), never from source control.
 */
@Injectable()
export class FieldEncryptionService {
  private readonly key: Buffer;
  readonly keyId: string;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.key = Buffer.from(cfg.FIELD_ENCRYPTION_KEY, 'base64');
    this.keyId = cfg.FIELD_ENCRYPTION_KEY_ID;
  }

  encrypt(plain: string): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]);
  }

  decrypt(blob: Buffer | Uint8Array, keyId: string): string {
    if (keyId !== this.keyId) throw new Error(`unknown field-encryption key id ${keyId}`);
    const b = Buffer.from(blob);
    const d = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  }
}
