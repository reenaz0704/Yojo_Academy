import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Errors } from '../errors/app-error';
import type { AppRequest } from '../http/request-context';
import { SettingsService } from '../../settings/settings.service';

/** Paths that stay open in maintenance so staff can sign in and switch it off (spec §8.2, §23). */
const OPEN = [
  '/api/v1/public/status',
  '/api/v1/health',
  '/api/v1/auth/staff',
  '/api/v1/auth/csrf',
  '/api/v1/auth/invite',
  '/api/v1/auth/password',
  '/api/v1/auth/logout',
];

@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly settings: SettingsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const role = req.session?.role;
    if (role === 'admin' || role === 'trainer') return true;
    const path = req.originalUrl.split('?')[0];
    if (OPEN.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}-`))) return true;
    const { value } = await this.settings.get('maintenance');
    if (value.enabled)
      throw Errors.unavailable('MAINTENANCE', value.message || 'Yojo is under maintenance. Please try again soon.');
    return true;
  }
}
