import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'D:/app/workspace/m1-cloudbase/tools';
for (const item of [
  { kind: 'pangu', old: 'v6', next: 'v7', oldMedia: 'pangu-subtitle-reading-2q-voiced-v6.mp4' },
  { kind: 'respect', old: 'v2', next: 'v3', oldMedia: 'respect-elders-subtitle-reading-2q-voiced-v2.mp4' },
]) {
  const importOld = item.kind === 'pangu'
    ? `run-cip-50055-pangu-voiced-v6-nonproduction-20261013.mjs`
    : `run-cip-50055-respect-voiced-v2-nonproduction-20261013.mjs`;
  const taskOld = item.kind === 'pangu'
    ? `probe-cip-50055-pangu-voiced-v6-task-20261013.mjs`
    : `probe-cip-50055-respect-voiced-v2-task-20261013.mjs`;
  const cloudName = item.kind === 'pangu' ? 'pangu' : 'respect';
  const oldDir = item.kind === 'pangu' ? 'video-211/v6' : 'video-232/v2';
  const prefix = item.kind === 'pangu' ? 'cip50055-211' : 'cip50055-232';
  const titleOld = item.kind === 'pangu' ? '盘古开天' : '尊重长辈';
  const answers = item.kind === 'pangu'
    ? ['Blue', 'Full of chaos', 'A big axe', 'The sky and earth', 'The sky']
    : ['Welcome to my home.', 'It is beautiful.', 'Grandpa and Grandma', 'Wait for Grandpa and Grandma', 'Older family members'];
  const transform = source => {
    let output = source.replaceAll(item.old, item.next).replaceAll('2q', '5q')
      .replaceAll('20261013', '20261014').replaceAll('2026-10-13', '2026-10-14')
      .replaceAll('two-question', 'five-question').replaceAll('Two-question', 'Five-question')
      .replaceAll('两题', '五题');
    if (item.kind === 'respect') {
      output = output.replaceAll('sbc0008-listening-v3-nonproduction-stage.json',
        'sbc0008-listening-v2-nonproduction-stage.json');
      output = output.replaceAll('respect-elders-subtitle-reading-5q-voiced-v3.mp4',
        'respect-elders-subtitle-reading-5q-voiced-v3.mp4');
      output = output.replaceAll('res_cip50055_respect_elders_video_5q_voiced_v3_20261014',
        'res_cip50055_respect_elders_video_5q_voiced_v3_20261014');
    }
    return output;
  };
  let code = transform(await readFile(join(root, importOld), 'utf8'));
  code = code.replace('lesson.questions.length !== 2', 'lesson.questions.length !== 5')
    .replace('item.questionCount !== 2', 'item.questionCount !== 5');
  const newMedia = item.kind === 'pangu'
    ? 'pangu-subtitle-reading-5q-voiced-v7.mp4'
    : 'respect-elders-subtitle-reading-5q-voiced-v3.mp4';
  code = code.replace(`const transcodedAt = (await stat(join(outputDir,\n  '${newMedia}'))).mtime.toISOString();`,
    `const transcodedAt = (await stat(join(assetRoot, 'library/derived/cip-50055-traditions/${oldDir}/${item.oldMedia}'))).mtime.toISOString();`);
  code = code.replace(`const crawlBytes = await read(join(sourceDir, 'source/crawl-receipt-v1.json'));`,
    `const crawlBytes = await read(join(sourceDir, 'source/crawl-receipt-v1.json'));\nconst reuseBytes = await read(join(outputDir, 'media-reuse-${item.next}.json'));`);
  code = code.replace(`|| review.lessonContentSha256.toLowerCase() !== hash(lessonBytes)`,
    `|| review.lessonContentSha256.toLowerCase() !== hash(lessonBytes)\n  || review.mediaReuseReceiptSha256.toLowerCase() !== hash(reuseBytes)`);
  code = code.replace(`  { key: 'technical', path:`,
    `  { key: 'reuse', path: \`\${pathPrefix}media-reuse-\${hash(reuseBytes).slice(0, 16)}.json\`, bytes: reuseBytes },\n  { key: 'technical', path:`);
  code = code.replace(`review.lessonContentSha256.toLowerCase() !== hash(lessonBytes)`,
    `review.lessonContentSha256.toLowerCase() !== hash(lessonBytes)`);
  await writeFile(join(root, `run-cip-50055-${cloudName}-5q-voiced-${item.next}-nonproduction-20261014.mjs`), code);
  let probe = transform(await readFile(join(root, taskOld), 'utf8'));
  const first = probe.indexOf('const questions = [');
  const last = probe.indexOf('];', first) + 2;
  if (first < 0 || last < 2) throw new Error('QUESTIONS_BLOCK_MISSING');
  const questionRows = answers.map((answer, index) =>
    `  { id: '${prefix}-q${index + 1}-${item.next}', answer: ${JSON.stringify(answer)} },`).join('\n');
  probe = probe.slice(0, first) + `const questions = [\n${questionRows}\n];` + probe.slice(last);
  probe = probe.replaceAll('两题', '五题');
  await writeFile(join(root, `probe-cip-50055-${cloudName}-5q-voiced-${item.next}-task-20261014.mjs`), probe);
  const retirementOld = item.kind === 'pangu'
    ? 'retire-cip-50055-pangu-v5-after-voiced-v6-20261013.mjs'
    : 'retire-cip-50055-respect-v1-after-voiced-v2-20261013.mjs';
  let retirement = await readFile(join(root, retirementOld), 'utf8');
  const former = item.kind === 'pangu'
    ? 'res_cip50055_pangu_video_2q_voiced_v6_20261013'
    : 'res_cip50055_respect_elders_video_2q_voiced_v2_20261013';
  const newId = item.kind === 'pangu'
    ? 'res_cip50055_pangu_video_5q_voiced_v7_20261014'
    : 'res_cip50055_respect_elders_video_5q_voiced_v3_20261014';
  retirement = retirement.replace(/const oldId = '[^']+';/u, `const oldId = '${former}';`)
    .replace(/const nextId = '[^']+';/u, `const nextId = '${newId}';`)
    .replace('next.payload?.teacherMedia?.questions?.length !== 2',
      'next.payload?.teacherMedia?.questions?.length !== 5')
    .replace(/old\.payload\?\.teacherMedia\?\.mediaSha256 !== '[^']+'/u,
      `old.payload?.teacherMedia?.mediaSha256 !== '${item.kind === 'pangu'
        ? 'e3d642f6399137d995839c42bb8498cb769339b90c5d0cd12005ea60c6c42db1'
        : '72e6794411c203962dc58748b9d007a3b57b3438f82cceea69bb210e67a749a1'}'`)
    .replaceAll('codex_cip50055_nonproduction_20261013', 'codex_cip50055_nonproduction_20261014')
    .replace('Stop new references to the silent', 'Stop new references to the two-question');
  await writeFile(join(root, `retire-cip-50055-${cloudName}-2q-after-5q-${item.next}-20261014.mjs`), retirement);
  process.stdout.write(`${titleOld}: cloud import and five-question task probe generated\n`);
}
