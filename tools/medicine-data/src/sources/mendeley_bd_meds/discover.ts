import type { Link } from '../types.js';

export const MENDELEY_FILE_URL = 'https://data.mendeley.com/public-files/datasets/zhtvkny53n/files/5a89a3c5-57e9-4ddf-bcde-16f4a9ec5d5d/file_downloaded';
export const MENDELEY_FILE_SHA256 = '293036d5c24268c6526df4ae9ba59e3d80f40380b79bdf40859c83419b52a8fd';

/** A single immutable, versioned CSV (DOI 10.17632/zhtvkny53n.1). */
export function seeds(): Link[] {
  return [{ url: MENDELEY_FILE_URL, kind: 'detail' }];
}
