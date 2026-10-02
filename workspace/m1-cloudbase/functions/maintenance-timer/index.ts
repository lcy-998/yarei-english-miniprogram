import { randomUUID } from 'node:crypto';
import { NotificationMaintenance, type MaintenanceReport } from '../../src/notification/maintenance';
import { createCloudBaseDocumentDatabase } from '../../src/repositories/cloudbase-document-database';
import { createM2BusinessReadIsolation } from '../../src/seed/m2-business-read-isolation';
import type { CloudBaseNodeSdkModulePort } from '../shared/cloudbase-node-deployment-bootstrap';
import { createMeta, failure, success } from '../../src/shared/result';
import type { ServiceResult } from '../../src/shared/protocol';

declare const require: (name: string) => unknown;
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

const TRIGGER_NAME = 'yarei_maintenance_minute';
const clock = { nowIso: () => new Date().toISOString() };
const ids = { next: (prefix: string) => `${prefix}_${randomUUID()}` };
const requestIds = { next: () => `maintenance_${randomUUID()}` };

export function createMaintenanceTimerFunction(dependencies: Readonly<{
  trustedTriggerSource(): string | null;
  maintenance: Pick<NotificationMaintenance, 'run'>;
  clock: { nowIso(): string };
  requestIds: { next(): string };
  alert?(message: string): void;
}>) {
  return async (event: unknown): Promise<ServiceResult<MaintenanceReport>> => {
    const meta = createMeta(dependencies.clock, dependencies.requestIds);
    if (dependencies.trustedTriggerSource() !== 'timer' || !isTimerEvent(event)) {
      return failure('FORBIDDEN', meta);
    }
    try {
      const report = await dependencies.maintenance.run();
      if (report.pendingRecoveryActivities > 0) {
        dependencies.alert?.(`Final leaderboard recovery pending for ${report.pendingRecoveryActivities} activity(s).`);
      }
      return success(report, meta);
    }
    catch { return failure('SERVICE_UNAVAILABLE', meta); }
  };
}

function isTimerEvent(event: unknown): boolean {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return false;
  const value = event as Record<string, unknown>;
  return value.Type === 'Timer' && value.TriggerName === TRIGGER_NAME
    && (value.Time === undefined || typeof value.Time === 'string' && Number.isFinite(Date.parse(value.Time)));
}

/** Platform gate is checked before any SDK initialization or maintenance work. */
export async function main(event: unknown): Promise<ServiceResult<MaintenanceReport>> {
  const source = process.env.TRIGGER_SRC ?? null;
  const meta = createMeta(clock, requestIds);
  if (source !== 'timer' || !isTimerEvent(event)) return failure('FORBIDDEN', meta);
  try {
    const sdk = require('@cloudbase/node-sdk') as CloudBaseNodeSdkModulePort;
    const contextEnv = sdk.getCloudbaseContext().TCB_ENV;
    const environmentId = typeof contextEnv === 'string' && contextEnv.trim()
      ? contextEnv : process.env.TCB_ENV ?? process.env.SCF_NAMESPACE;
    if (!environmentId) return failure('SERVICE_UNAVAILABLE', meta);
    const database = createM2BusinessReadIsolation(
      createCloudBaseDocumentDatabase(sdk.init({ env: environmentId }).database()));
    const maintenance = new NotificationMaintenance(database, clock, ids);
    return createMaintenanceTimerFunction({ trustedTriggerSource: () => source, maintenance, clock, requestIds })(event);
  } catch { return failure('SERVICE_UNAVAILABLE', meta); }
}
