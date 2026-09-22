import { createAuthoritativeM1SeedPackage } from './authoritative-fixture';
import { prepareSeedPackage } from './canonical-json';
import { SEED_COLLECTION_ORDER, type SeedPackage } from './model';

export const PRIMARY_CLOUD_INTEGRATION_ACTOR_USER_IDS = [
  'usr_student_g3_01',
  'usr_parent_demo_01',
  'usr_teacher_demo_01',
  'usr_admin_demo_01',
] as const;

export const PRIMARY_CLOUD_INTEGRATION_SEED_RUN_ID = 'seed_m1_cloud_integration_v4';
const PRIMARY_CLOUD_INTEGRATION_SEED_VERSION = 'm1-cloud-integration-v4';

const ACTOR_USER_IDS: ReadonlySet<string> = new Set(PRIMARY_CLOUD_INTEGRATION_ACTOR_USER_IDS);

/**
 * Derives the main-organization cloud integration fixture without mutating the
 * authoritative package. Only login identity placeholders are narrowed; all
 * domain users, roles, classes and learning/task records remain unchanged.
 */
export function createPrimaryCloudIntegrationSeedPackage(
  source: SeedPackage = createAuthoritativeM1SeedPackage(),
): SeedPackage {
  const collections = Object.fromEntries(SEED_COLLECTION_ORDER.map((collection) => [
    collection,
    source.collections[collection]
      .filter((document) => collection !== 'auth_identities'
        || typeof document.userId === 'string' && ACTOR_USER_IDS.has(document.userId))
      .map((document) => ({ ...document, seedRunId: PRIMARY_CLOUD_INTEGRATION_SEED_RUN_ID })),
  ])) as unknown as SeedPackage['collections'];
  const expectedCounts = Object.fromEntries(
    SEED_COLLECTION_ORDER.map((collection) => [collection, collections[collection].length]),
  );
  return prepareSeedPackage({
    manifest: {
      ...source.manifest,
      seedVersion: PRIMARY_CLOUD_INTEGRATION_SEED_VERSION,
      seedRunId: PRIMARY_CLOUD_INTEGRATION_SEED_RUN_ID,
      contentHash: 'RECOMPUTE_BEFORE_IMPORT',
      expectedCounts,
    },
    collections,
  });
}
