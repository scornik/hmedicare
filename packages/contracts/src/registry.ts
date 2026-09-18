import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// One registry for the whole API (TECHNOLOGY-STACK §2). Zod schemas here are the single source for request
// validation (nestjs-zod DTOs), OpenAPI 3.1 (TypeScript clients) and OpenAPI 3.0 (Dart client).
extendZodWithOpenApi(z);

export { z };
export const registry = new OpenAPIRegistry();

export const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Access token (EdDSA JWT). Web keeps it in memory; mobile in secure storage.',
});
