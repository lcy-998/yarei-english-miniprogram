import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'G:/英语资产/library/derived/cip-50055-traditions';
const v3Path = join(root, 'v1/review/topic-tags-v3.json');
const v4Path = join(root, 'v1/review/topic-tags-v4.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const previous = await readFile(v3Path);
const map = JSON.parse(previous);
map.revision = 4;
map.createdAt = '2026-10-14T10:58:10+08:00';
map.previousMapSha256 = hash(previous);
map.tagScope = 'Publisher topic/ID pairing and Codex editorial tags. Two current voiced course videos carry five distinct source-grounded questions. Longer book MP3s are linked by topic only and remain pending transcript review.';
for (const [sourceId, version, localId, cloudId, oldId] of [
  [211, 'v7', 'video-cip50055-pangu-5q-voiced-v7', 'res_cip50055_pangu_video_5q_voiced_v7_20261014', 'res_cip50055_pangu_video_2q_voiced_v6_20261013'],
  [232, 'v3', 'video-cip50055-respect-elders-5q-voiced-v3', 'res_cip50055_respect_elders_video_5q_voiced_v3_20261014', 'res_cip50055_respect_elders_video_2q_voiced_v2_20261013'],
]) {
  const pair = map.pairs.find(row => row.video.id === sourceId);
  if (!pair?.video.derived) throw new Error('TAG_PAIR_MISSING');
  const dir = join(root, sourceId === 211 ? 'video-211/v7' : 'video-232/v3');
  const lesson = await readFile(join(dir, `lesson-content-${version}.json`));
  const approved = await readFile(join('G:/英语资产/library/media', localId, 'v1/review/approved-content-v1.json'));
  const review = await readFile(join(dir, `codex-content-review-${version}.json`));
  pair.video.contentStatus = 'reviewed_voiced_video_with_five_questions_nonproduction';
  pair.video.derived = {
    ...pair.video.derived,
    localResourceId: localId, nonproductionCloudResourceId: cloudId,
    supersededTwoQuestionCloudResourceId: oldId,
    lessonContentSha256: hash(lesson), approvedContentSha256: hash(approved),
    contentReviewSha256: hash(review), questionCount: 5, productionReady: false,
  };
  pair.audio.pairedBookRecording.topicLinkedToVoicedVideo = cloudId;
  const receipt = {
    schemaVersion: 1, recordedAt: '2026-10-14T10:58:10+08:00',
    previousCloudResourceId: oldId, replacementCloudResourceId: cloudId,
    replacementQuestionCount: 5, replacementLessonSha256: hash(lesson),
    replacementReviewSha256: hash(review), previousSourceAndProjectionStatus: 'offline',
    historicalTaskSnapshotsPreserved: true, mediaDeleted: false,
  };
  const oldDir = join(root, sourceId === 211 ? 'video-211/v6' : 'video-232/v2');
  const receiptPath = join(oldDir, `supersession-${version}.json`);
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  try {
    if (hash(await readFile(receiptPath)) !== hash(receiptBytes)) throw new Error('SUPERSESSION_CONFLICT');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(receiptPath, receiptBytes, { flag: 'wx' });
  }
}
const bytes = Buffer.from(`${JSON.stringify(map, null, 2)}\n`);
try {
  if (hash(await readFile(v4Path)) !== hash(bytes)) throw new Error('TAG_MAP_CONFLICT');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await writeFile(v4Path, bytes, { flag: 'wx' });
}
process.stdout.write(JSON.stringify({ tagMapSha256: hash(bytes), pairCount: map.pairs.length,
  currentFiveQuestionVideos: map.pairs.filter(row => row.video.derived?.questionCount === 5).length }) + '\n');
