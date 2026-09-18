import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { RAW_DIR, RAW_RETENTION_DAYS } from '../config.js';

export const sha256 = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');

/** Compressed raw snapshots under .raw/<source>/ (gitignored), one latest snapshot per URL. */
export class RawStore {
  constructor(private readonly dir = RAW_DIR) {}

  pathFor(source: string, url: string): string {
    return path.join(this.dir, source, `${sha256(url).slice(0, 40)}.gz`);
  }

  write(source: string, url: string, body: Buffer, meta: Record<string, unknown>): string {
    const file = this.pathFor(source, url);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, zlib.gzipSync(body));
    fs.writeFileSync(file.replace(/\.gz$/, '.meta.json'), JSON.stringify({ url, ...meta }, null, 2));
    return path.relative(this.dir, file).split(path.sep).join('/');
  }

  read(relativePath: string): Buffer | null {
    const file = path.join(this.dir, relativePath);
    if (!fs.existsSync(file)) return null;
    return zlib.gunzipSync(fs.readFileSync(file));
  }

  /** Deletes snapshots older than the retention window. Returns number of files removed. */
  prune(days = RAW_RETENTION_DAYS, now = Date.now()): number {
    if (!fs.existsSync(this.dir)) return 0;
    let removed = 0;
    for (const source of fs.readdirSync(this.dir)) {
      const sourceDir = path.join(this.dir, source);
      if (!fs.statSync(sourceDir).isDirectory()) continue;
      for (const name of fs.readdirSync(sourceDir)) {
        const file = path.join(sourceDir, name);
        if (now - fs.statSync(file).mtimeMs > days * 86_400_000) { fs.rmSync(file); removed++; }
      }
    }
    return removed;
  }
}
