import {
  SeedOperationError,
  type SeedMigrationRun,
  type SeedMigrationStatus,
  type SeedRepositoryPort,
} from './apply-core';
import {
  MAX_SEED_BATCH_SIZE,
  advanceSeedBatchRollback,
  advanceSeedBatchRun,
  beginSeedBatchRollback,
  planSeedBatchRun,
  resumeFailedSeedBatchRun,
  type SeedBatchCoordinatorOptions,
  type SeedBatchRunState,
} from './batch-coordinator';
import { SEED_COLLECTION_ORDER, type SeedPackage } from './model';
import { validateSeedPackage } from './validator';
import type { SeedIdentityProfile } from './validator';

export const CONTROLLED_SEED_COMMANDS = [
  'status',
  'plan',
  'advance',
  'resume',
  'begin_rollback',
  'advance_rollback',
] as const;

export type ControlledSeedCommand = (typeof CONTROLLED_SEED_COMMANDS)[number];

export interface ControlledSeedOperatorRequest {
  readonly command: ControlledSeedCommand;
  readonly guard: Readonly<{
    readonly environmentPurpose: 'm1-non-production';
    readonly dataClassification: 'synthetic-only';
    /** Omitted is fixture-only; runtime must always be selected explicitly. */
    readonly identityProfile?: SeedIdentityProfile;
  }>;
  readonly expectedSeedRunId: string;
  readonly requestId: string;
  readonly executedBy: string;
  readonly batchSize: number;
}

export interface ControlledSeedOperatorResult {
  readonly command: ControlledSeedCommand;
  readonly requestId: string;
  readonly state: SeedBatchRunState | Readonly<{
    seedRunId: string;
    status: 'not_planned';
    nextBatchIndex: 0;
    totalBatches: number;
    verifiedBatchCount: 0;
    rollbackCursor: 0;
    createdCount: 0;
  }>;
}

export interface ControlledSeedOperatorDependencies {
  readonly repository: SeedRepositoryPort;
  readonly now: () => string;
}

/**
 * A deliberately stepwise seed boundary. It has no SDK/environment lookup and
 * exposes neither the coordinator's run-to-completion helpers nor seed bodies.
 */
export function createControlledSeedOperator(dependencies: ControlledSeedOperatorDependencies): Readonly<{
  execute(seed: SeedPackage, request: unknown): Promise<ControlledSeedOperatorResult>;
}> {
  return {
    execute: async (seed, input) => {
      const request = parseRequest(input, seed);
      const options: SeedBatchCoordinatorOptions = {
        requestId: request.requestId,
        executedBy: request.executedBy,
        batchSize: request.batchSize,
        identityProfile: request.guard.identityProfile ?? 'fixture',
        now: dependencies.now,
      };
      let state: ControlledSeedOperatorResult['state'];
      switch (request.command) {
        case 'status':
          state = await readStatus(dependencies.repository, seed, request);
          break;
        case 'plan':
          state = await planSeedBatchRun(dependencies.repository, seed, options);
          break;
        case 'advance':
          state = await advanceSeedBatchRun(dependencies.repository, seed, options);
          break;
        case 'resume':
          state = await resumeFailedSeedBatchRun(dependencies.repository, seed, options);
          break;
        case 'begin_rollback':
          await requireRollbackTarget(dependencies.repository, request);
          state = await beginSeedBatchRollback(
            dependencies.repository,
            request.expectedSeedRunId,
            { executedBy: request.executedBy, now: dependencies.now },
          );
          break;
        case 'advance_rollback':
          await requireRollbackTarget(dependencies.repository, request);
          state = await advanceSeedBatchRollback(
            dependencies.repository,
            request.expectedSeedRunId,
            { executedBy: request.executedBy, now: dependencies.now },
          );
          break;
      }
      return { command: request.command, requestId: request.requestId, state };
    },
  };
}

async function readStatus(
  repository: SeedRepositoryPort,
  seed: SeedPackage,
  request: ControlledSeedOperatorRequest,
): Promise<ControlledSeedOperatorResult['state']> {
  const run = await repository.transaction(async (transaction) => (
    transaction.getMigrationRun(seed.manifest.seedRunId)
  ));
  if (run === null) {
    const documentCount = SEED_COLLECTION_ORDER.reduce(
      (total, collection) => total + seed.collections[collection].length,
      0,
    );
    return {
      seedRunId: seed.manifest.seedRunId,
      status: 'not_planned',
      nextBatchIndex: 0,
      totalBatches: Math.ceil(documentCount / request.batchSize),
      verifiedBatchCount: 0,
      rollbackCursor: 0,
      createdCount: 0,
    };
  }
  assertRunMatchesSeed(run, seed, request);
  return safeRunState(run);
}

async function requireRollbackTarget(
  repository: SeedRepositoryPort,
  request: ControlledSeedOperatorRequest,
): Promise<void> {
  const run = await repository.transaction(async (transaction) => (
    transaction.getMigrationRun(request.expectedSeedRunId)
  ));
  if (run === null) throw new SeedOperationError('NOT_FOUND', '找不到对应的 migration run。');
  if (run._id !== request.expectedSeedRunId || run.createdDocumentIds.some((reference) => (
    reference.collection.length === 0 || reference.id.length === 0 || !/^sha256:[a-f0-9]{64}$/.test(reference.contentHash)
  ))) {
    throw new SeedOperationError('CONFLICT', 'migration run 的精确回滚记录无效。');
  }
}

function assertRunMatchesSeed(
  run: SeedMigrationRun,
  seed: SeedPackage,
  request: ControlledSeedOperatorRequest,
): void {
  const documentCount = SEED_COLLECTION_ORDER.reduce(
    (total, collection) => total + seed.collections[collection].length,
    0,
  );
  if (run._id !== seed.manifest.seedRunId
    || run.contentHash !== seed.manifest.contentHash
    || run.seedVersion !== seed.manifest.seedVersion
    || run.schemaVersion !== seed.manifest.schemaVersion
    || run.source !== seed.manifest.source
    || run.executedBy !== request.executedBy
    || run.requestId !== request.requestId
    || run.batchSize !== request.batchSize
    || run.totalBatches !== Math.ceil(documentCount / request.batchSize)
    || SEED_COLLECTION_ORDER.some((collection) => (
      run.counts[collection] !== seed.collections[collection].length
    ))) {
    throw new SeedOperationError('CONFLICT', 'migration run 与受控种子请求不一致。');
  }
}

function parseRequest(input: unknown, seed: SeedPackage): ControlledSeedOperatorRequest {
  if (!isRecord(input)) throw validationError('受控种子请求必须是对象。');
  assertExactKeys(input, [
    'command', 'guard', 'expectedSeedRunId', 'requestId', 'executedBy', 'batchSize',
  ], 'request');
  if (typeof input.command !== 'string'
    || !CONTROLLED_SEED_COMMANDS.includes(input.command as ControlledSeedCommand)) {
    throw validationError('不支持的受控种子命令。');
  }
  if (!isRecord(input.guard)) throw validationError('guard 必须是对象。');
  assertExactKeys(
    input.guard,
    ['environmentPurpose', 'dataClassification'],
    'guard',
    ['identityProfile'],
  );
  if (input.guard.environmentPurpose !== 'm1-non-production') {
    throw validationError('仅允许非生产 M1 环境用途。');
  }
  if (input.guard.dataClassification !== 'synthetic-only') {
    throw validationError('必须明确确认 synthetic-only。');
  }
  if (input.guard.identityProfile !== undefined
    && input.guard.identityProfile !== 'fixture'
    && input.guard.identityProfile !== 'runtime') {
    throw validationError('identityProfile 仅支持 fixture 或 runtime。');
  }
  const identityProfile = input.guard.identityProfile ?? 'fixture';
  const validation = validateSeedPackage(seed, { identityProfile });
  if (!validation.ok) throw validationError('种子未通过显式 identity profile 校验。');
  const expectedSeedRunId = requiredBoundedString(input.expectedSeedRunId, 'expectedSeedRunId');
  const isRollback = input.command === 'begin_rollback' || input.command === 'advance_rollback';
  if (!isRollback && expectedSeedRunId !== seed.manifest.seedRunId) {
    throw validationError('expectedSeedRunId 与 manifest 不一致。');
  }
  const requestId = requiredBoundedString(input.requestId, 'requestId');
  const executedBy = requiredBoundedString(input.executedBy, 'executedBy');
  if (typeof input.batchSize !== 'number' || !Number.isInteger(input.batchSize)
    || input.batchSize < 1 || input.batchSize > MAX_SEED_BATCH_SIZE) {
    throw validationError(`batchSize 必须是 1—${MAX_SEED_BATCH_SIZE} 的整数。`);
  }
  return {
    command: input.command as ControlledSeedCommand,
    guard: {
      environmentPurpose: 'm1-non-production',
      dataClassification: 'synthetic-only',
      ...(input.guard.identityProfile === undefined ? {} : { identityProfile }),
    },
    expectedSeedRunId,
    requestId,
    executedBy,
    batchSize: input.batchSize,
  };
}

function safeRunState(run: SeedMigrationRun): SeedBatchRunState {
  return {
    seedRunId: run._id,
    status: knownStatus(run.status),
    nextBatchIndex: requiredNonNegativeInteger(run.nextBatchIndex, 'nextBatchIndex'),
    totalBatches: requiredNonNegativeInteger(run.totalBatches, 'totalBatches'),
    verifiedBatchCount: requiredNonNegativeInteger(run.verifiedBatchCount, 'verifiedBatchCount'),
    rollbackCursor: requiredNonNegativeInteger(run.rollbackCursor, 'rollbackCursor'),
    createdCount: run.createdDocumentIds.length,
  };
}

function knownStatus(status: SeedMigrationStatus): SeedMigrationStatus {
  return status;
}

function requiredNonNegativeInteger(value: number | undefined, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new SeedOperationError('CONFLICT', `migration run ${field} 无效。`);
  }
  return value;
}

function requiredBoundedString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    throw validationError(`${field} 必须是 1—128 字符的非空字符串。`);
  }
  return value;
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  field: string,
  optional: readonly string[] = [],
): void {
  const allowedSet = new Set([...required, ...optional]);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown !== undefined) throw validationError(`${field}.${unknown} 是不支持的字段。`);
  const missing = required.find((key) => !(key in value));
  if (missing !== undefined) throw validationError(`${field}.${missing} 是必填字段。`);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validationError(message: string): SeedOperationError {
  return new SeedOperationError('VALIDATION_ERROR', message);
}
