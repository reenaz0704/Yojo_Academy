import { Client, startApp, type TestCtx } from './helpers';

/**
 * The sign-in page demo panel and the demo staff email-code sign-in exist only when APP_ENV is local or development.
 * Any other environment (this suite runs as "test", like staging and production) gets 404 from every route.
 */
describe('Sign-in demo routes outside local development', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(async () => ctx.app.close());

  it('answer 404: no demo directory, no demo inbox, no staff email-code sign-in', async () => {
    const c = await new Client(ctx.server).init();
    expect((await c.get('/dev/demo')).status).toBe(404);
    expect((await c.post('/dev/demo/staff/otp', { email: 'trainer@yojo.demo' })).status).toBe(404);
    expect(
      (await c.post('/dev/demo/staff/verify', { challengeId: 'x'.repeat(20), code: '123456', totp: '123456' })).status,
    ).toBe(404);
  });
});
