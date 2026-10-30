import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppError, ProblemBody } from './app-error';

const SLUG = (code: string) => code.toLowerCase().replace(/_/g, '-');

/** Renders every error in the single problem+json shape. Unknown errors never leak internals. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('ProblemFilter');

  catch(err: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const body = this.toProblem(err);
    body.requestId = String(req.id ?? '');
    if (body.status >= 500) this.log.error({ err, requestId: body.requestId }, 'unhandled error');
    if (body.status === 429 && typeof body.details.retryAfterSec === 'number')
      res.setHeader('Retry-After', String(body.details.retryAfterSec));
    res.status(body.status).type('application/problem+json').send(body);
  }

  private toProblem(err: unknown): ProblemBody {
    if (err instanceof AppError) {
      return {
        type: `about:blank#${SLUG(err.code)}`,
        code: err.code,
        message: err.message,
        status: err.getStatus(),
        field: err.opts.field ?? null,
        needs: err.opts.needs ?? null,
        details: err.opts.details ?? {},
      };
    }
    if (err instanceof HttpException) {
      const status = err.getStatus();
      const raw = err.getResponse();
      const code =
        status === 404
          ? 'NOT_FOUND'
          : status === 413
            ? 'PAYLOAD_TOO_LARGE'
            : status === 400
              ? 'BAD_REQUEST'
              : 'HTTP_ERROR';
      const message = typeof raw === 'string' ? raw : status === 404 ? 'Not found.' : err.message;
      return { type: `about:blank#${SLUG(code)}`, code, message, status, field: null, needs: null, details: {} };
    }
    // body-parser errors (raised before Nest sees the request): too large, or not valid JSON.
    const bp = err as { type?: unknown; status?: unknown } | null;
    if (bp && typeof bp === 'object' && (bp.type === 'entity.too.large' || bp.type === 'entity.parse.failed')) {
      const large = bp.type === 'entity.too.large';
      return {
        type: `about:blank#${large ? 'payload-too-large' : 'bad-request'}`,
        code: large ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
        message: large ? 'This request is too large.' : 'The request body is not valid JSON.',
        status: large ? 413 : 400,
        field: null,
        needs: null,
        details: {},
      };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return {
        type: 'about:blank#conflict',
        code: 'CONFLICT',
        message: 'This record already exists.',
        status: 409,
        field: null,
        needs: null,
        details: {},
      };
    }
    return {
      type: 'about:blank#internal',
      code: 'INTERNAL',
      message: 'Something went wrong on our side.',
      status: 500,
      field: null,
      needs: null,
      details: {},
    };
  }
}
