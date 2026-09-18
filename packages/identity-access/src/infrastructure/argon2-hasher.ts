import * as argon2 from 'argon2';
import type { PasswordHasherPort } from '../application/ports';

export interface Argon2Params {
  memoryKiB: number;
  timeCost: number;
  parallelism: number;
}

/** Argon2id (AUTH-IMPLEMENTATION §1). Parameters from config; rehash on login when they change. */
export class Argon2idHasher implements PasswordHasherPort {
  constructor(private readonly params: Argon2Params) {}

  hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.params.memoryKiB,
      timeCost: this.params.timeCost,
      parallelism: this.params.parallelism,
    });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, {
      memoryCost: this.params.memoryKiB,
      timeCost: this.params.timeCost,
      parallelism: this.params.parallelism,
    });
  }
}

/** Password policy for staff accounts: length only (NIST SP 800-63B style), no composition rules. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
