import type { SourceAdapter } from './types.js';
import { dgda } from './dgda/index.js';
import { lazzpharma } from './lazzpharma/index.js';
import { mendeleyBdMeds } from './mendeley_bd_meds/index.js';

/**
 * Adapters exist only for sources whose compliance review permits acquisition.
 * PROHIBITED sources (medex, arogga, medeasy_en, medeasy_bn, osudpotro, dims_app) deliberately
 * have no parser: they contribute no records until written permission or a licensed feed exists.
 */
export const ADAPTERS: Record<string, SourceAdapter> = {
  dgda,
  mendeley_bd_meds: mendeleyBdMeds,
  lazzpharma
};
