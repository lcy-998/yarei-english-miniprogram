import type { CloudBaseNativeDatabasePort } from '../repositories/cloudbase-document-database';
import { createCloudBaseDocumentDatabase } from '../repositories/cloudbase-document-database';
import { createControlledSeedOperator, type ControlledSeedOperatorResult } from './controlled-operator';
import { createSeedDocumentDatabaseRepository } from './document-database-repository';
import type { SeedPackage } from './model';
import { validateSeedPackage } from './validator';

export type CloudSeedPackageName = 'primary' | 'secondary';

export interface CloudBaseControlledSeedPackages {
  readonly primary: SeedPackage;
  readonly secondary: SeedPackage;
}

const MAX_VERIFIED_PORT_OPERATIONS = 80;

/**
 * Wires the existing stepwise operator to the real CloudBase transaction port.
 * Credentials and environment selection remain outside this module.
 */
export function createCloudBaseControlledSeedOperator(
  nativeDatabase: CloudBaseNativeDatabasePort,
  packages: CloudBaseControlledSeedPackages,
  now: () => string,
): Readonly<{
  execute(packageName: CloudSeedPackageName, request: unknown): Promise<ControlledSeedOperatorResult>;
}> {
  const database = createCloudBaseDocumentDatabase(nativeDatabase, { pageSize: 100, maxPages: 2 });
  const operators = {
    primary: createPackageOperator(database, packages.primary, now),
    secondary: createPackageOperator(database, packages.secondary, now),
  } as const;
  return {
    execute: async (packageName, request) => operators[packageName].operator.execute(
      operators[packageName].seed,
      request,
    ),
  };
}

function createPackageOperator(
  database: ReturnType<typeof createCloudBaseDocumentDatabase>,
  seed: SeedPackage,
  now: () => string,
): Readonly<{
  seed: SeedPackage;
  operator: ReturnType<typeof createControlledSeedOperator>;
}> {
  const validation = validateSeedPackage(seed, { identityProfile: 'runtime' });
  if (!validation.ok) throw new Error('Cloud seed package failed runtime validation.');
  if (seed.collections.organizations.length !== 1) {
    throw new Error('Cloud seed package must contain exactly one organization.');
  }
  const organizationId = seed.collections.organizations[0]?.organizationId;
  if (typeof organizationId !== 'string' || organizationId.trim().length === 0) {
    throw new Error('Cloud seed organization boundary is unavailable.');
  }
  const repository = createSeedDocumentDatabaseRepository(database, {
    organizationId,
    maxPortOperationsPerTransaction: MAX_VERIFIED_PORT_OPERATIONS,
  });
  return { seed, operator: createControlledSeedOperator({ repository, now }) };
}
