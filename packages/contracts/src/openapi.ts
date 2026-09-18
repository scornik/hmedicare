import { OpenApiGeneratorV3, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry';
import './health';
import './auth';

const info = {
  title: 'HMedic API',
  version: '1.0.0',
  description:
    'HMedic clinic platform API. Generated from packages/contracts (do not edit the JSON by hand). ' +
    'Business routes live under /api/v1; health routes at the root.',
};
const servers = [{ url: 'http://localhost:3000', description: 'Local development' }];

/** OpenAPI 3.1.0 document (TypeScript clients). */
export function buildOpenApiV31(): Record<string, unknown> {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info,
    servers,
  }) as unknown as Record<string, unknown>;
}

/** OpenAPI 3.0.3 document (Dart client via swagger_parser). */
export function buildOpenApiV30(): Record<string, unknown> {
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info,
    servers,
  }) as unknown as Record<string, unknown>;
}

/** Stable JSON (sorted object keys) so generated files diff cleanly. */
export function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}
