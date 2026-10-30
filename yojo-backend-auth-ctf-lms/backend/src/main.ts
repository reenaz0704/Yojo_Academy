import 'reflect-metadata';
import { loadLocalEnv } from './config/load-env';
loadLocalEnv();
import { createApp } from './bootstrap';
import { APP_CONFIG } from './config/config.module';
import type { AppConfig } from './config/config.schema';

async function main(): Promise<void> {
  const app = await createApp();
  const cfg = app.get<AppConfig>(APP_CONFIG);
  await app.listen(cfg.PORT);
}

main().catch((err: unknown) => {
  // Config errors list variable names only (see loadConfig).
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
