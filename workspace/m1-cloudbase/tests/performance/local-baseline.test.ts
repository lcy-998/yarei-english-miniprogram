import { describe, expect, it } from 'vitest';
import { createAuthoritativeM1SeedPackage } from '../../src/seed/authoritative-fixture';
import { validateSeedPackage } from '../../src/seed/validator';

describe('M1 零预算本地性能基线', () => {
  it('重复生成并校验权威虚构种子，记录本地后端基线而不访问云端', () => {
    const samples: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      const started = performance.now();
      const seed = createAuthoritativeM1SeedPackage();
      const result = validateSeedPackage(seed);
      const elapsed = performance.now() - started;
      expect(result.ok).toBe(true);
      samples.push(elapsed);
    }
    const sorted = [...samples].sort((left, right) => left - right);
    const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
    const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    console.info(`[m1-local-baseline] seed+validate samples=${samples.length} averageMs=${average.toFixed(2)} p95Ms=${p95.toFixed(2)}`);
    expect(p95).toBeLessThan(2_000);
  });
});
