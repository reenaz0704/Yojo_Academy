import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Yojo Cyber Academy API')
    .setDescription(
      'Milestone 1 (Foundation). Errors are application/problem+json with code, message, field and needs. ' +
        'Unsafe methods need X-CSRF-Token (GET /api/v1/auth/csrf). Step-up routes need X-Step-Up-Code.',
    )
    .setVersion('1.0.0-m1')
    .addCookieAuth('ys', { type: 'apiKey', in: 'cookie', name: '__Host-ys' })
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token' }, 'csrf')
    .build();
  return SwaggerModule.createDocument(app, config);
}
