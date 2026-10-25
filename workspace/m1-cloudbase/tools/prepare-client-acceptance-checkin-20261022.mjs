// Publish a seven-day reading + vocabulary check-in for the virtual grade-three class.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const mode = process.argv[2];
if (!['inspect', 'apply', 'verify'].includes(mode)) throw new Error('MODE_INVALID');
const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'package.json'));
const { build } = require('esbuild');
const envId = 'cloud1-d8ggzrwwedb786e41';
const orgId = 'org_qihang_demo';
const teacherId = 'usr_teacher_demo_01';
const studentId = 'usr_student_g3_01';
const classId = 'cls_grade3_2';
const activityId = 'activity_client_accept_20261022_read_vocab';
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
function cliJson(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  if (parsed.error) throw new Error(`CLOUD_CLI_FAILED:${args[0]}`);
  return parsed.data;
}
const config = JSON.parse(await readFile(join(root, 'cloudbaserc.json'), 'utf8'));
const localEnv = (await readFile(join(root, '.env.local'), 'utf8')).split(/\r?\n/u)
  .find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
const envs = cliJson(['env', 'list', '--json']);
if (config.envId !== envId || localEnv !== envId || !Array.isArray(envs)
  || envs.length !== 1 || envs[0].EnvId !== envId || envs[0].Status !== 'NORMAL'
  || envs[0].EnableOverrun !== false || envs[0].EnvPaid !== 'no'
  || envs[0].EnvCharged !== 'no') throw new Error('NONPRODUCTION_COST_GATE');
const quota = cliJson(['api', 'tcb', 'DescribeQuotaData', '--api-version', '2018-06-08',
  '--body', JSON.stringify({ EnvId: envId, MetricName: 'DbWritepkg' }), '--json']);
if (!Number.isFinite(quota.Value) || quota.Value > 180000) throw new Error('WRITE_QUOTA_GATE');
const token = cliJson(['secrets', 'get', '--json']);
if (token?.envId !== envId || token.isTemporary !== true
  || Date.parse(token.expiredAt) <= Date.now() + 60_000) throw new Error('TEMP_CREDENTIAL_GATE');
const app = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: token.secretId, secretKey: token.secretKey, sessionToken: token.token });
const entry = join(root, '.runtime/client-acceptance-20261022/entry-checkin.cjs');
await mkdir(resolve(entry, '..'), { recursive: true });
await build({ entryPoints: [join(root, 'src/seed/m2-acceptance-entry.ts')], outfile: entry,
  bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent' });
const api = require(entry);
const db = api.createCloudBaseDocumentDatabase(app.database());
const [teacher, student, roles, grants, membership, reading, vocabulary, prior] = await Promise.all([
  db.get('users', teacherId), db.get('users', studentId),
  db.find('role_assignments', { organizationId: orgId, userId: teacherId,
    status: 'active', deletedAt: null }),
  db.find('teacher_class_grants', { organizationId: orgId, teacherId, classId,
    status: 'active', deletedAt: null }),
  db.find('class_memberships', { organizationId: orgId, studentId, classId,
    status: 'active', deletedAt: null }),
  db.get('learning_resources', 'res_formal_sbc0008_v1_20261007'),
  db.get('learning_resources', 'supplement-pep3a-u2-complete-v1'),
  db.get('checkin_activities', activityId),
]);
const role = roles.find(item => item.role === 'teacher');
if (teacher?.status !== 'active' || student?.status !== 'active'
  || teacher.organizationId !== orgId || student.organizationId !== orgId
  || !role?.permissions?.includes('task.publish') || grants.length === 0
  || membership.length !== 1 || reading?.status !== 'published'
  || reading.type !== 'reading' || vocabulary?.status !== 'published'
  || vocabulary.type !== 'vocabulary' || vocabulary.payload?.words?.length < 5) {
  throw new Error('TEACHER_STUDENT_RESOURCE_GATE');
}
const nowSchool = new Date(Date.now() + 8 * 3600_000);
const schoolDay = new Date(Date.UTC(nowSchool.getUTCFullYear(), nowSchool.getUTCMonth(),
  nowSchool.getUTCDate()));
const day = offset => new Date(schoolDay.getTime() + offset * 86400_000).toISOString().slice(0, 10);
const dates = { startsOn: day(0), endsOn: day(6), restDates: [day(3)] };
const clock = { nowIso: () => new Date().toISOString() };
const ids = { next: prefix => prefix === 'activity' ? activityId
  : `${prefix}_client_accept_checkin_20261022` };
const activityService = new api.ActivityService(new api.DocumentActivityRepository(db), clock, ids);
const teacherActor = { requestId: 'request_client_accept_checkin_20261022',
  sessionId: 'client-acceptance-checkin', actorUserId: teacherId, actorRole: 'teacher',
  organizationId: orgId, platformSubjectDigest: 'client-acceptance-checkin',
  permissions: role.permissions, scopeIds: [classId], authzVersion: teacher.authzVersion ?? 1 };
const studentActor = { ...teacherActor, requestId: 'request_client_accept_checkin_student_20261022',
  actorUserId: studentId, actorRole: 'student', permissions: [],
  authzVersion: student.authzVersion ?? 1 };
if (mode === 'inspect') {
  if (prior) throw new Error('ACTIVITY_ID_NOT_EMPTY');
  process.stdout.write(JSON.stringify({ status: 'ready', activityId, dates,
    conditions: ['reading', 'vocabulary'], quotaWrites: quota.Value }) + '\n');
  process.exit(0);
}
if (mode === 'apply') {
  let activity = prior;
  if (!activity) {
    activity = await activityService.saveDraft(teacherActor, {
      title: '甲方验收｜七天绘本与单词打卡',
      description: '虚构三年级班级：每天完成绘本阅读与五个家人主题单词，第四天休息。',
      classId, ...dates, conditions: [
        { kind: 'reading', resourceId: reading._id },
        { kind: 'vocabulary', resourceId: vocabulary._id, requiredWordCount: 5 },
      ],
    }, 0, 'op_client_accept_checkin_draft_20261022');
  }
  if (activity.status === 'draft') {
    activity = await activityService.publish(teacherActor, activityId, activity.version,
      'op_client_accept_checkin_publish_20261022');
  }
  process.stdout.write(JSON.stringify({ stage: 'published', activityId,
    status: activity.status, participants: activity.participants?.length ?? null }) + '\n');
}
const current = await activityService.getForStudent(studentActor, activityId);
const teachers = await activityService.listForTeacher(teacherActor);
if (current.status !== 'published' || current.participants.length < 30
  || !current.participants.some(row => row.studentId === studentId)
  || current.schedule.conditions.length !== 2
  || current.dailyInstances.length !== 6
  || !teachers.some(row => row.id === activityId)) throw new Error('ACTIVITY_READBACK_FAILED');
const today = await activityService.getMyDay(studentActor, activityId, current.schedule.startsOn);
if (today.activityId !== activityId || today.restDay === true) throw new Error('ACTIVITY_DAY_READBACK_FAILED');
process.stdout.write(JSON.stringify({ status: 'verified', activityId,
  participants: current.participants.length, effectiveDays: current.dailyInstances.length,
  restDays: current.schedule.restDates.length,
  studentAndTeacherRead: true }) + '\n');
