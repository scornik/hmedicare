import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const merge = createRequire(require.resolve('nestjs-zod'))('deepmerge') as (
  target: object,
  source: object,
) => Record<string, unknown>;

it('rejects prototype-mutating keys in the patched nestjs-zod dependency', () => {
  const malicious = JSON.parse(
    '{"__proto__":{"poisoned":true},"constructor":{"prototype":{"poisoned":true}},"prototype":{"poisoned":true},"safe":1}',
  ) as object;
  const result = merge(Object.create(null) as object, malicious);
  expect(result).toEqual({ safe: 1 });
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect(({} as Record<string, unknown>).poisoned).toBeUndefined();
});
