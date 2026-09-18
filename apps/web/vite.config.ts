import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig, loadEnv } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

/** WEB-IMPLEMENTATION §3: only public build-time config; any VITE_* name that looks secret fails the build. */
const SECRET_NAME = /SECRET|KEY|TOKEN|PASSWORD/i;
export function assertNoSecretNames(env: Record<string, string | undefined>): void {
  const bad = Object.keys(env).filter((k) => k.startsWith('VITE_') && SECRET_NAME.test(k));
  if (bad.length) throw new Error(`Refusing to build: secret-looking public env names: ${bad.join(', ')}`);
}

/** Copies the Hostinger .htaccess template (HOST-012: SPA fallback + security headers) into dist. */
function htaccess(apiOrigin: string): Plugin {
  return {
    name: 'hm-htaccess',
    apply: 'build',
    closeBundle() {
      const template = readFileSync(
        path.resolve(here, '../../infrastructure/hostinger/web.htaccess'),
        'utf8',
      );
      const out = template
        .split(/\r?\n/)
        .map((l) => (l.trimStart().startsWith('#') ? l : l.replaceAll('__API_ORIGIN__', apiOrigin)))
        .join('\n');
      writeFileSync(path.resolve(here, 'dist/.htaccess'), out);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, here, 'VITE_'), ...process.env };
  assertNoSecretNames(env);
  const apiOrigin = new URL(env.VITE_API_BASE_URL ?? 'http://localhost:3000').origin;
  return {
    plugins: [react(), htaccess(apiOrigin)],
    // Workspace packages are consumed from TypeScript source (same condition the Node packages use).
    resolve: { conditions: ['development', 'browser', 'module', 'import', 'default'] },
    server: { port: 5173, strictPort: true },
    build: { outDir: 'dist', sourcemap: false, emptyOutDir: true },
  };
});
