import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { seed } from '../prisma/seed';

/**
 * Runs once before the e2e suite: applies pending migrations to the dedicated test database (non-destructive
 * `migrate deploy`; tests use unique emails so earlier rows do not matter), seeds it, and clears the dedicated test
 * Redis DB (rate-limit windows and sessions). Refuses any database not named *_test and any Redis DB other than 15.
 */
export default async function globalSetup(): Promise<void> {
  await import('./setup-env');
  const url = new URL(process.env.DATABASE_URL!);
  if (!url.pathname.replace('/', '').endsWith('_test')) throw new Error('e2e tests only run against a *_test database');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    shell: process.platform === 'win32', // npx is a .cmd file on Windows; the arguments are constants
    stdio: 'pipe',
  });
  const prisma = new PrismaClient();
  await seed(prisma);
  await prisma.$disconnect();
  if (new URL(process.env.REDIS_URL!).pathname !== '/15') throw new Error('e2e tests only run against Redis DB 15');
  const redis = new Redis(process.env.REDIS_URL!);
  await redis.flushdb();
  await redis.quit();
}
