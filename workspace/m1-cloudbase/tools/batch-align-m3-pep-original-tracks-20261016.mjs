import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const run = promisify(execFile);
const manifest = JSON.parse(await readFile(
  'G:/英语资产/library/derived/pep-current-chapter-narration-2026-10-15/v2/narration-manifest.json', 'utf8'));
const script = 'D:/app/workspace/m1-cloudbase/tools/align-m3-pep-original-track-20261016.mjs';
const root = 'G:/英语资产/library/derived/pep-pointread-alignment-2026-10-16/v1';
const tasks = [...new Map(manifest.chapters.flatMap(chapter => chapter.publisherTracks.map(track => {
  const index = Number(track.sourceFile.match(/track-(\d+)\.mp3$/u)?.[1]);
  return [`${chapter.bookId}:${index}`, { bookId: chapter.bookId, index }];
}))).values()];
if (tasks.length !== 93 || tasks.some(item => !Number.isSafeInteger(item.index))) {
  throw new Error('TRACK_SCOPE_GATE');
}
const pending = tasks.filter(item => !existsSync(join(root, item.bookId,
  `track-${String(item.index).padStart(3, '0')}-vosk.json`)));
const completed = [];
const failures = [];
let next = 0;
async function worker() {
  while (next < pending.length) {
    const item = pending[next++];
    try {
      const { stdout } = await run(process.execPath, [script, item.bookId, String(item.index)], {
        cwd: 'D:/app/workspace/m1-cloudbase', timeout: 240000,
        windowsHide: true, maxBuffer: 1024 * 1024,
      });
      const result = JSON.parse(stdout.trim().split(/\r?\n/u).at(-1));
      if (result.bookId !== item.bookId || result.trackIndex !== item.index
        || result.wordCount < 2) throw new Error('ALIGNMENT_OUTPUT_GATE');
      completed.push({ bookId: item.bookId, index: item.index,
        wordCount: result.wordCount, elapsedMs: result.elapsedMs });
    } catch (error) {
      failures.push({ bookId: item.bookId, index: item.index,
        code: String(error.message).slice(0, 80) });
    }
    if ((completed.length + failures.length) % 10 === 0) {
      process.stdout.write(`PROGRESS=${completed.length + failures.length}/${pending.length};failed=${failures.length}\n`);
    }
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
const report = { startedFromExisting: tasks.length - pending.length,
  attempted: pending.length, completed, failures, totalExpected: tasks.length };
await writeFile('G:/英语资产/reports/pep-pointread-cloud-alignment-batch-2026-10-16.json',
  JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ expected: tasks.length, existing: tasks.length - pending.length,
  completed: completed.length, failed: failures.length }) + '\n');
if (failures.length) process.exitCode = 1;
