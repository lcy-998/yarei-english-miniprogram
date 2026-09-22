import type { JsonValue } from '../shared/protocol';
import type { SeedPackage } from './model';

interface HashPort {
  update(value: string, encoding: 'utf8'): HashPort;
  digest(encoding: 'hex'): string;
}

declare const require: (moduleName: 'node:crypto') => { createHash(algorithm: 'sha256'): HashPort };

export const CONTENT_HASH_PREFIX = 'sha256:';
export const CONTENT_HASH_PLACEHOLDER = 'RECOMPUTE_BEFORE_IMPORT';

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
}

export function computeSeedContentHash(seed: SeedPackage): string {
  const { contentHash: _ignored, ...manifest } = seed.manifest;
  const hashInput = {
    manifest,
    collections: seed.collections,
  } as unknown as JsonValue;
  return computeJsonContentHash(hashInput);
}

export function computeJsonContentHash(value: JsonValue): string {
  return `${CONTENT_HASH_PREFIX}${require('node:crypto').createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

export function prepareSeedPackage(seed: SeedPackage): SeedPackage {
  const contentHash = computeSeedContentHash(seed);
  return {
    manifest: { ...seed.manifest, contentHash },
    collections: seed.collections,
  };
}
