import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArguments(process.argv.slice(2));
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const envId = requireValue(config.envId);
const bundle = join(root, '.runtime', 'm2-predeploy-20260927', 'm2-cloud-operator.cjs');
let stage = 'build';

try {
  await build({ entryPoints: [join(root, 'src', 'seed', 'm2-cloud-operator-entry.ts')],
    outfile: bundle, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
  stage = 'temporary-credentials';
  const credentials = await temporaryCredentials(resolveCliLaunch(args.tcbCli));
  if (credentials.envId !== envId) throw new Error('ENVIRONMENT_MISMATCH');
  stage = 'cloud-read';
  const sdk = require('@cloudbase/js-sdk');
  const app = sdk.init({ env: envId, secretId: credentials.secretId,
    secretKey: credentials.secretKey, sessionToken: credentials.token });
  const api = require(bundle);
  const database = api.createCloudBaseDocumentDatabase(app.database());
  if (args.command.startsWith('activity-capacity-')) {
    stage = 'activity-capacity-command';
    const operator = api.createM2ActivityCapacityFixtureOperator(database);
    let result;
    if (args.command === 'activity-capacity-status') result = await operator.inspect();
    else if (args.command === 'activity-capacity-plan') result = await operator.plan(new Date().toISOString());
    else if (args.command === 'activity-capacity-fill') {
      result = await operator.inspect();
      for (let step = 0; result.status !== 'ready' && step < 50; step += 1) {
        result = await operator.advance(new Date().toISOString());
        if (result.active % 50 === 0 || result.status === 'ready') {
          process.stdout.write(`ACTIVITY_CAPACITY_FILL=${result.active}/464\n`);
        }
      }
      if (result.status !== 'ready') throw new Error('ACTIVITY_CAPACITY_FILL_INCOMPLETE');
    } else if (args.command === 'activity-capacity-begin-retire') {
      result = await operator.beginRetire(args.activityId ?? null, new Date().toISOString());
    } else {
      result = await operator.inspect();
      for (let step = 0; result.status !== 'retired' && step < 50; step += 1) {
        result = await operator.retire(new Date().toISOString());
        if (result.retired % 50 === 0 || result.status === 'retired') {
          process.stdout.write(`ACTIVITY_CAPACITY_RETIRE=${result.retired}/464\n`);
        }
      }
      if (result.status !== 'retired') throw new Error('ACTIVITY_CAPACITY_RETIRE_INCOMPLETE');
    }
    process.stdout.write(`ACTIVITY_CAPACITY_STATUS=${result.status}\n`);
    process.stdout.write(`ACTIVITY_CAPACITY_ACTIVE=${result.active}/464\n`);
    process.stdout.write(`ACTIVITY_CAPACITY_RETIRED=${result.retired}/464\n`);
    process.stdout.write(`ACTIVITY_CAPACITY_CLASS_VERSION=${result.classVersion}\n`);
  } else if (args.command === 'simulate-finalization') {
    stage = 'virtual-finalization';
    const cls = await database.get('classes', 'cls_grade3_2');
    const memberships = await database.find('class_memberships', { organizationId: 'org_qihang_demo',
      classId: 'cls_grade3_2', status: 'active', deletedAt: null });
    const capacityRun = await database.get('migration_runs', 'seed_m2_activity_capacity_500_v1');
    if (cls?.status !== 'active' || memberships.length !== 36 || capacityRun?.status !== 'retired') {
      throw new Error('VIRTUAL_FINALIZATION_PREFLIGHT_FAILED');
    }
    const activityId = 'activity_m2_virtual_finalization_demo';
    let sequence = 0;
    const ids = { next: prefix => prefix === 'activity' ? activityId
      : `${prefix}_virtual_finalization_${++sequence}` };
    const teacher = { requestId: 'request_m2_virtual_finalization', sessionId: 'server-integration',
      actorUserId: 'usr_teacher_demo_01', actorRole: 'teacher', organizationId: 'org_qihang_demo',
      platformSubjectDigest: 'server-integration', permissions: ['task.publish', 'task.read'],
      scopeIds: ['cls_grade3_2'], authzVersion: 1 };
    const student = { ...teacher, actorRole: 'student', actorUserId: 'usr_student_g3_01',
      permissions: [], scopeIds: [] };
    const serviceAt = time => new api.ActivityService(new api.DocumentActivityRepository(database),
      { nowIso: () => time }, ids);
    let activity = await database.get('checkin_activities', activityId);
    if (activity === null) {
      const draft = await serviceAt('2026-09-26T08:00:00+08:00').saveDraft(teacher,
        { title: '虚构最终榜单事务演练', classId: 'cls_grade3_2', startsOn: '2026-09-26',
          endsOn: '2026-09-26', restDates: [],
          conditions: [{ kind: 'exercise', resourceId: 'res_m2_exercise_animals_choice_demo',
            minimumScore: 60 }] }, 0, 'operation_m2_virtual_finalization_draft_20260927');
      process.stdout.write(`VIRTUAL_ACTIVITY_DRAFT_VERSION=${draft.version}\n`);
      activity = await database.get('checkin_activities', activityId);
    }
    if (activity?.status === 'draft') {
      const published = await serviceAt('2026-09-26T08:01:00+08:00').publish(teacher,
        activityId, activity.version, 'operation_m2_virtual_finalization_publish_20260927');
      process.stdout.write(`VIRTUAL_ACTIVITY_PUBLISHED_PARTICIPANTS=${published.participants.length}\n`);
    }
    const clock = '2026-09-27T00:02:00+08:00';
    const service = serviceAt(clock);
    const first = await service.finalizeActivity('org_qihang_demo', activityId);
    const repeat = await service.finalizeActivity('org_qihang_demo', activityId);
    const board = await service.getLeaderboard(student, activityId);
    if (first.lockedAt !== clock || repeat.lockedAt !== first.lockedAt
      || board.evidenceStatus !== 'available' || board.leaderboard?.finalized !== true
      || board.leaderboard.ranks.length !== 36) throw new Error('VIRTUAL_FINALIZATION_MISMATCH');
    process.stdout.write('VIRTUAL_FINALIZATION=passed\n');
    process.stdout.write(`VIRTUAL_FINAL_RANKS=${board.leaderboard.ranks.length}\n`);
    process.stdout.write('VIRTUAL_FINAL_SNAPSHOTS=1\n');
  } else if (args.command.startsWith('capacity-')) {
    stage = 'capacity-command';
    const operator = api.createM2CapacityFixtureOperator(database);
    let result;
    if (args.command === 'capacity-status' || args.command === 'capacity-inspect') {
      result = await operator.inspect();
    } else if (args.command === 'capacity-plan') {
      const current = await api.proposeM2CurrentDependencyBaseline(database);
      if (args.reviewedDigest !== current.digest) throw new Error('BASELINE_DRIFT');
      result = await operator.plan(new Date().toISOString());
    } else if (args.command === 'capacity-advance') {
      result = await operator.advance(new Date().toISOString());
    } else if (args.command === 'capacity-fill') {
      result = await operator.inspect();
      for (let step = 0; result.status !== 'ready' && step < 50; step += 1) {
        result = await operator.advance(new Date().toISOString());
        if (result.created % 50 === 0 || result.status === 'ready') {
          process.stdout.write(`CAPACITY_FILL_PROGRESS=${result.created}/464\n`);
        }
      }
      if (result.status !== 'ready') throw new Error('CAPACITY_FILL_INCOMPLETE');
    } else if (args.command === 'capacity-begin-retire') {
      result = await operator.beginRetire(args.taskId ?? null, new Date().toISOString());
    } else if (args.command === 'capacity-drain') {
      result = await operator.inspect();
      for (let step = 0; result.status !== 'retired' && step < 50; step += 1) {
        result = await operator.retire(new Date().toISOString());
        if (result.retired % 50 === 0 || result.status === 'retired') {
          process.stdout.write(`CAPACITY_RETIRE_PROGRESS=${result.retired}/464\n`);
        }
      }
      if (result.status !== 'retired') throw new Error('CAPACITY_RETIRE_INCOMPLETE');
    } else {
      result = await operator.retire(new Date().toISOString());
    }
    process.stdout.write(`CAPACITY_STATUS=${result.status}\n`);
    process.stdout.write(`CAPACITY_CREATED=${result.created}/464\n`);
    process.stdout.write(`CAPACITY_RETIRED=${result.retired}/464\n`);
    process.stdout.write(`CAPACITY_CLASS_VERSION=${result.classVersion}\n`);
  } else {
  const baseline = await api.proposeM2CurrentDependencyBaseline(database);
  stage = 'command';
  if (args.command === 'inspect') {
    process.stdout.write(`BASELINE_DIGEST=${baseline.digest}\n`);
    process.stdout.write(`BASE_RUN_STATUS=${baseline.baseRun.status}/${baseline.baseRun.failedFromStatus}\n`);
    process.stdout.write(`BASE_RUN_VERSION=${baseline.baseRun.version}\n`);
    process.stdout.write(`BASE_RUN_REFERENCES=${baseline.baseRun.createdReferenceCount}\n`);
    process.stdout.write(`BASE_ROLLBACK_CURSOR=${baseline.baseRun.rollbackCursor}\n`);
    process.stdout.write(`DEPENDENCY_COUNT=${baseline.dependencies.length}\n`);
    const exerciseId = 'res_m2_exercise_animals_choice_demo';
    const rawExercise = await database.get('learning_resources', exerciseId);
    const business = api.createM2BusinessReadIsolation(database);
    const businessExercise = await business.get('learning_resources', exerciseId);
    const resources = api.createOrgContentDocumentRepository(business);
    const decoded = await resources.findLearningResource('org_qihang_demo', exerciseId);
    process.stdout.write(`EXERCISE_RAW=${rawExercise !== null}\n`);
    process.stdout.write(`EXERCISE_GATED=${businessExercise !== null}\n`);
    process.stdout.write(`EXERCISE_DECODED=${decoded !== null}\n`);
  } else if (args.command === 'inspect-capacity') {
    const cls = await database.get('classes', 'cls_grade3_2');
    const active = await database.find('class_memberships', { organizationId: 'org_qihang_demo',
      classId: 'cls_grade3_2', status: 'active', deletedAt: null });
    const first = await database.get('users', 'usr_m2_capacity_0001');
    const last = await database.get('users', 'usr_m2_capacity_0464');
    const inactive = await database.find('class_memberships', { organizationId: 'org_qihang_demo',
      classId: 'cls_grade3_2', status: 'inactive', seedRunId: 'seed_m2_capacity_500_v1',
      deletedAt: null });
    const disabled = await database.find('users', { organizationId: 'org_qihang_demo',
      status: 'disabled', seedRunId: 'seed_m2_capacity_500_v1', deletedAt: null });
    process.stdout.write(`CAPACITY_CLASS_VERSION=${cls?.version ?? 'missing'}\n`);
    process.stdout.write(`CAPACITY_ACTIVE_MEMBERS=${active.length}\n`);
    process.stdout.write(`CAPACITY_INACTIVE_FIXTURE=${inactive.length}\n`);
    process.stdout.write(`CAPACITY_DISABLED_FIXTURE=${disabled.length}\n`);
    process.stdout.write(`CAPACITY_CANDIDATES_EXIST=${first !== null || last !== null}\n`);
  } else if (args.command === 'inspect-maintenance') {
    const cursor = await database.get('maintenance_scan_state', 'maintenance_scan_v1');
    const events = await database.find('notification_events', { organizationId: 'org_qihang_demo',
      deletedAt: null });
    process.stdout.write(`MAINTENANCE_CURSOR_VERSION=${cursor?.version ?? 0}\n`);
    process.stdout.write(`MAINTENANCE_NOTIFICATION_EVENTS=${events.length}\n`);
  } else if (args.command === 'diagnose-maintenance') {
    const reads = { get: 0, find: 0, findPage: 0, simulatedWrites: 0 };
    const preview = {
      get: (collection, id) => { reads.get += 1; return database.get(collection, id); },
      find: (collection, criteria) => { reads.find += 1; return database.find(collection, criteria); },
      findPage: (collection, criteria, page) => { reads.findPage += 1;
        if (collection === 'organizations') return database.get('organizations', 'org_qihang_demo')
          .then(row => ({ items: row ? [row] : [], hasMore: false }));
        return database.findPage(collection, criteria, page); },
      runTransaction: work => work({
        get: (collection, id) => { reads.get += 1; return database.get(collection, id); },
        find: (collection, criteria) => { reads.find += 1; return database.find(collection, criteria); },
        create: async () => { reads.simulatedWrites += 1; return true; },
        replace: async () => { reads.simulatedWrites += 1; return true; },
        append: async () => { reads.simulatedWrites += 1; return true; },
        delete: async () => { throw new Error('DRY_RUN_DELETE_FORBIDDEN'); },
      }),
    };
    const maintenance = new api.NotificationMaintenance(preview,
      { nowIso: () => '2026-09-28T20:00:00+08:00' }, { next: () => 'dry_run_id' });
    const startedAt = Date.now();
    try {
      const report = await maintenance.run();
      process.stdout.write(`MAINTENANCE_DRY_RUN=passed;elapsedMs=${Date.now() - startedAt}\n`);
      process.stdout.write(`MAINTENANCE_SCAN=tasks:${report.scannedTasks},activities:${report.scannedActivities}\n`);
      process.stdout.write(`MAINTENANCE_WOULD_CREATE=due:${report.createdDueReminders},checkin:${report.createdCheckinReminders}\n`);
    } catch (error) {
      process.stdout.write(`MAINTENANCE_DRY_RUN=failed:${safeCode(error)};elapsedMs=${Date.now() - startedAt}\n`);
    }
    process.stdout.write(`MAINTENANCE_READS=get:${reads.get},find:${reads.find},page:${reads.findPage}\n`);
    process.stdout.write(`MAINTENANCE_SIMULATED_WRITES=${reads.simulatedWrites}\n`);
  } else if (args.command === 'diagnose-activity') {
    const counts = { get: 0, find: 0 };
    let lastCollection = 'none';
    const startedAt = Date.now();
    const activityId = args.activityId ?? 'activity_m2_animals_choice_demo';
    const observed = { ...database, runTransaction: work => database.runTransaction(tx => work({
      ...tx,
      get: (collection, id) => { counts.get += 1; lastCollection = collection; return tx.get(collection, id); },
      find: (collection, criteria) => { counts.find += 1; lastCollection = collection;
        return tx.find(collection, criteria); },
    })) };
    const service = new api.ActivityService(new api.DocumentActivityRepository(observed),
      { nowIso: () => new Date().toISOString() }, { next: () => 'unused' });
    try {
      await service.getLeaderboard({ organizationId: 'org_qihang_demo', actorUserId: 'usr_student_g3_01',
        actorRole: 'student', permissions: [], scopeIds: ['cls_grade3_2'], requestId: 'm2_diagnostic' },
      activityId);
      process.stdout.write('ACTIVITY_DIAGNOSTIC=passed\n');
    } catch (error) {
      process.stdout.write(`ACTIVITY_DIAGNOSTIC=failed:${safeCode(error)}\n`);
      process.stdout.write(`ACTIVITY_DIAGNOSTIC_KIND=${safeCode({ code: error?.kind })}\n`);
      process.stdout.write(`ACTIVITY_DIAGNOSTIC_CAUSE=${safeCode({ code: error?.cause?.code })}\n`);
      process.stdout.write(`ACTIVITY_LAST_COLLECTION=${lastCollection}\n`);
      const activity = await database.get('checkin_activities', activityId);
      const firstStudentId = activity?.payload?.participants?.[0]?.studentId;
      if (typeof firstStudentId === 'string') {
        const assignments = await database.find('task_assignments', { organizationId: 'org_qihang_demo',
          studentId: firstStudentId, classId: 'cls_grade3_2', deletedAt: null });
        process.stdout.write(`ACTIVITY_FIRST_STUDENT_ASSIGNMENTS=${assignments.length}\n`);
        process.stdout.write(`ACTIVITY_ASSIGNMENTS_WITHOUT_ID=${assignments.filter(row => typeof row.id !== 'string').length}\n`);
        process.stdout.write(`ACTIVITY_ASSIGNMENTS_WITHOUT_TASK=${assignments.filter(row => typeof row.taskId !== 'string').length}\n`);
        process.stdout.write(`ACTIVITY_ASSIGNMENTS_BAD_LATEST=${assignments.filter(row => row.latestSubmissionId !== null
          && typeof row.latestSubmissionId !== 'string').length}\n`);
        const firstSubmitted = assignments.find(row => typeof row.latestSubmissionId === 'string');
        if (firstSubmitted && typeof firstSubmitted.taskId === 'string') {
          const task = await database.get('tasks', firstSubmitted.taskId);
          process.stdout.write(`ACTIVITY_FIRST_SUBMITTED_TASK_FOUND=${task !== null}\n`);
          process.stdout.write(`ACTIVITY_FIRST_SUBMITTED_TASK_HAS_ID=${typeof task?.id === 'string'}\n`);
          process.stdout.write(`ACTIVITY_FIRST_SUBMITTED_TASK_HAS_ITEMS=${Array.isArray(task?.items)}\n`);
          process.stdout.write(`ACTIVITY_FIRST_SUBMITTED_TASK_ITEMS_VALID=${Array.isArray(task?.items)
            && task.items.every(item => item && typeof item.resourceId === 'string'
              && item.resourceSnapshot && typeof item.resourceSnapshot.type === 'string')}\n`);
        }
      }
    }
    process.stdout.write(`ACTIVITY_READS=get:${counts.get},find:${counts.find}\n`);
    process.stdout.write(`ACTIVITY_ELAPSED_MS=${Date.now() - startedAt}\n`);
  } else {
    if (args.reviewedDigest !== baseline.digest) throw new Error('BASELINE_DRIFT');
    if (args.command === 'grant-demo-admin') {
      const outcome = await api.grantM2DemoAdminRestorePermission(database, new Date().toISOString());
      process.stdout.write(`DEMO_ADMIN_RESTORE_GRANT=${outcome}\n`);
    } else {
      const operator = api.createM2AuditedCloudOperator(database,
        { baseline, reviewedDigest: args.reviewedDigest });
      const result = await operator.execute({ command: args.command,
        guard: { environmentPurpose: 'm2-non-production', dataClassification: 'synthetic-only' },
        expectedSeedRunId: operator.plan.seedRunId,
        requestId: `request_m2_${operator.plan.contentHash.slice(7, 39)}`,
        executedBy: 'm2_local_controlled_seed_operator', batchSize: 2 });
      process.stdout.write(`STATUS=${result.status}\n`);
      process.stdout.write(`BATCH=${result.nextBatchIndex}/${result.totalBatches}\n`);
      process.stdout.write(`VERIFIED=${result.verifiedBatchCount}/${result.totalBatches}\n`);
      process.stdout.write(`CREATED=${result.createdCount}\n`);
      process.stdout.write(`ROLLBACK_CURSOR=${result.rollbackCursor}\n`);
    }
  }
  }
} catch (error) {
  process.stderr.write(`M2_SEED_OPERATOR_ERROR=${safeCode(error)};stage=${stage}\n`);
  process.exitCode = 2;
} finally {
  process.stdout.write('M2_SEED_OPERATOR_COMPLETE=1\n');
}
await new Promise(resolve => setTimeout(resolve, 500));
process.exit(process.exitCode ?? 0);

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (value === undefined || !['--tcb-cli', '--command', '--reviewed-digest', '--task-id', '--activity-id'].includes(key)
      || Object.hasOwn(parsed, key)) throw new Error('INVALID_ARGUMENTS');
    parsed[key] = value;
  }
  if (typeof parsed['--tcb-cli'] !== 'string' || !existsSync(resolve(parsed['--tcb-cli']))
    || !['inspect', 'status', 'plan', 'advance', 'resume', 'begin_rollback', 'advance_rollback',
      'grant-demo-admin', 'diagnose-activity', 'inspect-capacity', 'inspect-maintenance',
      'simulate-finalization',
      'diagnose-maintenance',
      'capacity-status', 'capacity-inspect', 'capacity-plan', 'capacity-advance',
      'capacity-fill', 'capacity-begin-retire', 'capacity-retire', 'capacity-drain',
      'activity-capacity-status', 'activity-capacity-plan', 'activity-capacity-fill',
      'activity-capacity-begin-retire', 'activity-capacity-drain']
      .includes(parsed['--command'])
    || (!['inspect', 'diagnose-activity', 'diagnose-maintenance', 'inspect-capacity', 'inspect-maintenance',
      'simulate-finalization', 'capacity-status',
      'capacity-inspect', 'capacity-advance', 'capacity-fill', 'capacity-begin-retire',
      'capacity-retire', 'capacity-drain', 'activity-capacity-status', 'activity-capacity-plan',
      'activity-capacity-fill', 'activity-capacity-begin-retire', 'activity-capacity-drain']
      .includes(parsed['--command'])
      && !/^sha256:[a-f0-9]{64}$/u.test(parsed['--reviewed-digest'] ?? ''))
    || (['inspect', 'diagnose-activity', 'diagnose-maintenance', 'inspect-capacity', 'inspect-maintenance',
      'simulate-finalization', 'capacity-status',
      'capacity-inspect', 'capacity-advance', 'capacity-fill', 'capacity-begin-retire',
      'capacity-retire', 'capacity-drain', 'activity-capacity-status', 'activity-capacity-plan',
      'activity-capacity-fill', 'activity-capacity-begin-retire', 'activity-capacity-drain']
      .includes(parsed['--command'])
      && parsed['--reviewed-digest'] !== undefined)) {
    throw new Error('INVALID_ARGUMENTS');
  }
  if ((parsed['--task-id'] !== undefined && parsed['--command'] !== 'capacity-begin-retire')
    || (parsed['--task-id'] !== undefined && !/^[A-Za-z0-9:_-]{1,128}$/u.test(parsed['--task-id']))) {
    throw new Error('INVALID_ARGUMENTS');
  }
  if ((parsed['--activity-id'] !== undefined
    && !['activity-capacity-begin-retire', 'diagnose-activity'].includes(parsed['--command']))
    || (parsed['--activity-id'] !== undefined
      && !/^[A-Za-z0-9:_-]{1,128}$/u.test(parsed['--activity-id']))) {
    throw new Error('INVALID_ARGUMENTS');
  }
  return { tcbCli: resolve(parsed['--tcb-cli']), command: parsed['--command'],
    reviewedDigest: parsed['--reviewed-digest'], taskId: parsed['--task-id'],
    activityId: parsed['--activity-id'] };
}

function resolveCliLaunch(tcbCli) {
  if (!tcbCli.toLowerCase().endsWith('.cmd')) return { command: tcbCli, arguments: [] };
  const bin = dirname(tcbCli);
  const candidates = [resolve(bin, '..', '@cloudbase', 'cli', 'bin', 'tcb'),
    resolve(bin, 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb')];
  return { command: process.execPath, arguments: [candidates.find(existsSync) ?? candidates[0]] };
}

async function temporaryCredentials(cli) {
  const { stdout } = await execute(cli.command, [...cli.arguments, 'secrets', 'get', '--json'],
    { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
  const starts = [stdout.indexOf('{'), stdout.indexOf('[')].filter(index => index >= 0);
  if (starts.length === 0) throw new Error('TEMPORARY_CREDENTIALS_UNAVAILABLE');
  const data = JSON.parse(stdout.slice(Math.min(...starts)))?.data;
  if (data?.isTemporary !== true || !Number.isFinite(Date.parse(data.expiredAt))
    || Date.parse(data.expiredAt) <= Date.now() + 60_000) {
    throw new Error('TEMPORARY_CREDENTIALS_INVALID');
  }
  return { envId: requireValue(data.envId), secretId: requireValue(data.secretId),
    secretKey: requireValue(data.secretKey), token: requireValue(data.token) };
}
function requireValue(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('REQUIRED_PRIVATE_VALUE_UNAVAILABLE');
  return value.trim();
}
function safeCode(error) {
  const value = error?.code ?? error?.message ?? error?.name ?? 'UNAVAILABLE';
  return /^[A-Z][A-Z0-9_]{2,80}$/u.test(String(value)) ? String(value) : 'UNAVAILABLE';
}
