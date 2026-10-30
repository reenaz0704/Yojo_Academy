import { ValidationError, ValidationPipe } from '@nestjs/common';
import { Errors } from '../errors/app-error';

function flatten(errors: ValidationError[], parent = ''): { field: string; message: string }[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

/** Whitelist + forbid unknown properties (spec §3.4 step 7); errors become one 400 with every field listed. */
export const appValidationPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    stopAtFirstError: false,
    exceptionFactory: (errors) => {
      const list = flatten(errors);
      const first = list[0] ?? { field: undefined, message: 'Invalid request.' };
      return Errors.validation(first.message, first.field, { errors: list });
    },
  });
