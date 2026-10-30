import { existsSync } from 'node:fs';

/** Local convenience: read ./.env when present (never in production, where the platform injects variables). */
export function loadLocalEnv(): void {
  if (process.env.NODE_ENV !== 'production' && existsSync('.env')) process.loadEnvFile('.env');
}
