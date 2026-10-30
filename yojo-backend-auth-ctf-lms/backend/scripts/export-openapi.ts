/** Writes the OpenAPI document to openapi.json without starting a server port (needs DATABASE_URL/REDIS_URL set). */
import 'reflect-metadata';
import { loadLocalEnv } from '../src/config/load-env';
loadLocalEnv();
import { writeFileSync } from 'node:fs';
import { createApp } from '../src/bootstrap';
import { buildOpenApi } from '../src/openapi';

async function main(): Promise<void> {
  const app = await createApp({ logger: false });
  await app.init();
  const doc = buildOpenApi(app);
  writeFileSync('openapi.json', JSON.stringify(doc, null, 2));
  process.stdout.write(`openapi.json written (${Object.keys(doc.paths).length} paths)\n`);
  await app.close();
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
