// Read-only inventory for the three virtual demo accounts. Prints counts and field paths only.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envId = 'cloud1-d8ggzrwwedb786e41';
const cli = 'D:/app-cache/cloudbase-cli/node_modules/@cloudbase/cli/bin/tcb';
const config = JSON.parse(readFileSync(resolve(root, 'cloudbaserc.json'), 'utf8'));
const localEnv = readFileSync(resolve(root, '.env.local'), 'utf8')
  .split(/\r?\n/u).find(line => line.startsWith('TCB_ENV_ID='))?.slice(11).trim();
if (config.envId !== envId || localEnv !== envId) throw new Error('ENVIRONMENT_MISMATCH');

function cliJson(args) {
  const raw = execFileSync(process.execPath, [cli, ...args], { cwd: root,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  if (parsed.error) throw new Error(`CLI_FAILED:${args[0]}`);
  return parsed.data;
}
const envs = cliJson(['env', 'list', '--json']);
if (!Array.isArray(envs) || envs.length !== 1 || envs[0].EnvId !== envId
  || envs[0].Status !== 'NORMAL' || envs[0].EnableOverrun !== false
  || envs[0].EnvPaid !== 'no' || envs[0].EnvCharged !== 'no') {
  throw new Error('NONPRODUCTION_OR_COST_GATE');
}
const credentials = cliJson(['secrets', 'get', '--json']);
if (credentials?.isTemporary !== true || credentials.envId !== envId
  || Date.parse(credentials.expiredAt) <= Date.now() + 60_000) {
  throw new Error('TEMP_CREDENTIAL_GATE');
}
const tableList = cliJson(['api', 'tcb', 'ListTables', '--region', 'ap-shanghai',
  '--body', JSON.stringify({ EnvId: envId, MgoLimit: 1000, MgoOffset: 0 }), '--json']);
if (!Array.isArray(tableList.Tables) || tableList.Pager?.Total !== tableList.Tables.length) {
  throw new Error('TABLE_LIST_INCOMPLETE');
}
const require = createRequire(resolve(root, 'package.json'));
const db = require('@cloudbase/node-sdk').init({ env: envId,
  secretId: credentials.secretId, secretKey: credentials.secretKey,
  sessionToken: credentials.token }).database();
const targets = new Map([
  ['usr_student_g3_01', 'student'],
  ['usr_teacher_demo_01', 'teacher'],
  ['usr_parent_demo_01', 'parent'],
  ['13800138000', 'studentPhone'],
  ['13800138001', 'teacherPhone'],
  ['13800138002', 'parentPhone'],
]);
const knownFieldPaths = new Map();
function scan(value, path, matches) {
  if (typeof value === 'string') {
    const label = targets.get(value);
    if (label) matches.add(`${label}:${path}`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) scan(item, `${path}[]`, matches);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) scan(item, path ? `${path}.${key}` : key, matches);
  }
}
const rowsByTable = new Map();
for (const table of tableList.Tables) {
  const name = table.TableName;
  const expected = Number(table.Count);
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error(`COUNT_INVALID:${name}`);
  const rows = [];
  for (let offset = 0; offset < expected; offset += 100) {
    const result = await db.collection(name).skip(offset).limit(100).get();
    if (!Array.isArray(result.data) || result.data.length === 0) throw new Error(`PAGE_EMPTY:${name}`);
    rows.push(...result.data);
  }
  if (rows.length !== expected || new Set(rows.map(row => row._id)).size !== expected) {
    throw new Error(`TABLE_CHANGED_OR_INCOMPLETE:${name}`);
  }
  rowsByTable.set(name, rows);
  const matched = rows.map(row => {
    const paths = new Set();
    scan(row, '', paths);
    return { id: row._id, paths: [...paths].sort() };
  }).filter(row => row.paths.length > 0);
  if (matched.length > 0) {
    const pathCounts = {};
    for (const row of matched) for (const path of row.paths) pathCounts[path] = (pathCounts[path] ?? 0) + 1;
    knownFieldPaths.set(name, pathCounts);
    process.stdout.write(JSON.stringify({ table: name, total: expected,
      matched: matched.length, pathCounts }) + '\n');
  }
}

const studentId = 'usr_student_g3_01';
const teacherId = 'usr_teacher_demo_01';
const tasks = rowsByTable.get('tasks') ?? [];
const assignments = rowsByTable.get('task_assignments') ?? [];
const teacherTasks = tasks.filter(row => row.creatorTeacherId === teacherId);
const teacherTaskIds = new Set(teacherTasks.map(row => row._id));
const teacherTaskAssignments = assignments.filter(row => teacherTaskIds.has(row.taskId));
const studentAssignments = assignments.filter(row => row.studentId === studentId);
const sharedTasks = teacherTasks.map(task => ({ id: task._id, status: task.status,
  visibility: task.visibility, otherStudentAssignments: teacherTaskAssignments.filter(row =>
    row.taskId === task._id && row.studentId !== studentId).length,
  studentAssignment: studentAssignments.some(row => row.taskId === task._id) }));
const activities = rowsByTable.get('checkin_activities') ?? [];
const activitySummary = activities.filter(row => row.creatorTeacherId === teacherId).map(row => ({
  id: row._id, status: row.status,
  otherParticipants: (row.payload?.participants ?? []).filter(item =>
    item.studentId !== studentId).length,
}));
process.stdout.write(JSON.stringify({ summary: true, tableCount: tableList.Tables.length,
  teacherTasks: teacherTasks.length,
  tasksWithOtherStudentAssignments: sharedTasks.filter(row => row.otherStudentAssignments > 0).length,
  otherStudentAssignmentsAcrossTeacherTasks: sharedTasks.reduce((sum, row) =>
    sum + row.otherStudentAssignments, 0),
  teacherTasksWithoutOtherStudentAssignments: sharedTasks.filter(row =>
    row.otherStudentAssignments === 0).length,
  visibleTeacherTasksWithOtherStudents: sharedTasks.filter(row =>
    row.visibility === 'visible' && row.otherStudentAssignments > 0).length,
  teacherActivities: activitySummary.length,
  activitiesWithOtherStudents: activitySummary.filter(row => row.otherParticipants > 0).length,
  otherParticipantsAcrossActivities: activitySummary.reduce((sum, row) =>
    sum + row.otherParticipants, 0),
  studentAssignments: studentAssignments.length,
  teacherTaskAssignments: teacherTaskAssignments.length,
  targetAccountRows: (rowsByTable.get('users') ?? []).filter(row =>
    targets.has(row._id)).map(row => ({ id: row._id, status: row.status })) }) + '\n');

const mediaTables = ['pronunciation_recordings', 'task_recordings', 'student_works',
  'task_dubbing_works', 'teacher_private_videos', 'review_voice_drafts'];
function leafPaths(value, path, paths) {
  if (Array.isArray(value)) {
    for (const item of value) leafPaths(item, `${path}[]`, paths);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) leafPaths(item,
      path ? `${path}.${key}` : key, paths);
  } else if (typeof value === 'string' && /file|media|audio|video|storage|cloud/iu.test(path)) {
    paths.add(path);
  }
}
for (const name of mediaTables) {
  const rows = rowsByTable.get(name) ?? [];
  const matched = rows.filter(row => {
    const paths = new Set();
    scan(row, '', paths);
    return paths.size > 0;
  });
  const paths = new Set();
  for (const row of matched) leafPaths(row, '', paths);
  process.stdout.write(JSON.stringify({ mediaTable: name, matched: matched.length,
    mediaFieldPaths: [...paths].sort() }) + '\n');
}

const storageFields = new Set(['fileId', 'stagingFileId', 'mediaId', 'mediaAssetKey']);
function collectStorageRefs(value, refs) {
  if (Array.isArray(value)) {
    for (const item of value) collectStorageRefs(item, refs);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (storageFields.has(key) && typeof item === 'string' && item) refs.add(item);
      collectStorageRefs(item, refs);
    }
  }
}
const targetStorageRefs = new Set();
for (const name of mediaTables) {
  for (const row of rowsByTable.get(name) ?? []) {
    const paths = new Set();
    scan(row, '', paths);
    if (paths.size > 0) collectStorageRefs(row, targetStorageRefs);
  }
}
const otherStorageRefs = new Set();
for (const [name, rows] of rowsByTable) {
  if (mediaTables.includes(name)) continue;
  for (const row of rows) collectStorageRefs(row, otherStorageRefs);
}
const sharedStorageRefs = [...targetStorageRefs].filter(ref => otherStorageRefs.has(ref)).length;
const storage = cliJson(['storage', 'list', '--json']);
const storageKeys = Array.isArray(storage) ? new Map(storage.map(item => [item.key, item])) : new Map();
const matchedObjects = [...targetStorageRefs].map(ref => {
  const key = ref.startsWith('cloud://') ? ref.replace(/^cloud:\/\/[^/]+\//u, '') : ref;
  return storageKeys.get(key) ?? null;
}).filter(Boolean);
process.stdout.write(JSON.stringify({ storageSummary: true,
  targetMediaFileRefs: targetStorageRefs.size,
  refsAlsoInOtherDocumentTables: sharedStorageRefs,
  listedStorageObjects: Array.isArray(storage) ? storage.length : null,
  matchedStorageObjects: matchedObjects.length,
  matchedStorageBytes: matchedObjects.reduce((sum, item) => sum + Number(item.size || 0), 0),
  fileIdExample: [...targetStorageRefs][0] ?? null }) + '\n');
