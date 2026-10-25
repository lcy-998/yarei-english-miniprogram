// Offline inventory of references to business users other than the three retained accounts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const folder = 'C:/Users/18167/AppData/Local/Yarei/three-demo-cleanup-backup-2026-10-22T05-41-58-168Z';
const read = name => JSON.parse(readFileSync(join(folder, 'database', `${name}.json`), 'utf8'));
const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
const retain = new Set(['usr_student_g3_01', 'usr_teacher_demo_01', 'usr_parent_demo_01']);
const remove = new Set(read('users').filter(row => !retain.has(row._id)).map(row => row._id));
function scan(value, path, paths) {
  if (typeof value === 'string') {
    if (remove.has(value)) paths.add(path);
  } else if (Array.isArray(value)) {
    for (const item of value) scan(item, `${path}[]`, paths);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) scan(item,
      path ? `${path}.${key}` : key, paths);
  }
}
for (const name of Object.keys(manifest.collections)) {
  const counts = {};
  let matched = 0;
  for (const row of read(name)) {
    const paths = new Set();
    scan(row, '', paths);
    if (paths.size > 0) matched += 1;
    for (const path of paths) counts[path] = (counts[path] ?? 0) + 1;
  }
  if (matched > 0) console.log(JSON.stringify({ table: name, matched, paths: counts }));
}
