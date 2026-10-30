import type { AppConfig } from '../../config/config.schema';

/** A page served from this computer: localhost or 127.0.0.1 on any port (pages server, VS Code Live Server). */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/**
 * Which browser origins may call the API with credentials. Production, staging and every non-local setup allow only
 * PUBLIC_APP_URL. On a developer's machine (APP_ENV local or development) a page served from localhost on any port
 * is allowed too, so the same pages work from the pages server on :8000 and from VS Code Live Server on :5500.
 */
export function allowedOrigin(cfg: Pick<AppConfig, 'APP_ENV' | 'PUBLIC_APP_URL'>, origin: string | undefined): boolean {
  if (!origin) return true; // same-origin requests and non-browser clients send no Origin header
  if (origin === cfg.PUBLIC_APP_URL.replace(/\/$/, '')) return true;
  return (cfg.APP_ENV === 'local' || cfg.APP_ENV === 'development') && LOCAL_ORIGIN.test(origin);
}
