// Build immutable five-question lesson packages from the already verified voiced videos.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'G:/英语资产';
const base = join(root, 'library/derived/cip-50055-traditions');
const now = '2026-10-14T10:48:19+08:00';
const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
async function immutable(path, bytes) {
  try {
    const existing = await readFile(path);
    if (hash(existing) !== hash(bytes)) throw new Error(`IMMUTABLE_CONFLICT ${path}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, bytes, { flag: 'wx' });
  }
}
const specs = [
  {
    source: 'video-211/v6', target: 'video-211/v7', version: 'v7', previous: 'v6',
    oldName: 'pangu-subtitle-reading-2q-voiced-v6.mp4',
    newName: 'pangu-subtitle-reading-5q-voiced-v7.mp4',
    inboxName: 'cip50055-pangu-5q-voiced-v7.mp4',
    localId: 'video-cip50055-pangu-5q-voiced-v7',
    cloudOld: 'res_cip50055_pangu_video_2q_voiced_v6_20261013',
    title: '盘古开天｜有声字幕阅读与五题理解（出版社原声）',
    role: 'part_1_myths_and_legends', topic: 'topic_111', gradeNumber: 4,
    questions: [
      ['What color is the sky when the children begin talking?', ['Blue', 'Red', 'Gray'], 'Blue', 'The children first describe the sky as blue.', ['The sky is so blue today.']],
      ['How is the world described before Pangu appears?', ['Full of chaos', 'Full of flowers', 'Full of cities'], 'Full of chaos', 'The story says that the world was full of chaos.', ['The world was full of chaos.']],
      ['What did Pangu use to split heaven and earth?', ['A big axe', 'A bow', 'A compass'], 'A big axe', 'The caption names a big axe as his tool.', ['He used a big axe to split heaven and earth']],
      ['What appeared after Pangu used the axe?', ['The sky and earth', 'A bridge', 'A palace'], 'The sky and earth', 'The next story line says the sky and earth appeared.', ['The sky and earth appeared.']],
      ['What did Pangu hold up?', ['The sky', 'The moon', 'A mountain'], 'The sky', 'Pangu stood between sky and earth and held up the sky.', ['Pangu stood between them and held up the sky.']],
    ],
  },
  {
    source: 'video-232/v2', target: 'video-232/v3', version: 'v3', previous: 'v2',
    oldName: 'respect-elders-subtitle-reading-2q-voiced-v2.mp4',
    newName: 'respect-elders-subtitle-reading-5q-voiced-v3.mp4',
    inboxName: 'cip50055-respect-elders-5q-voiced-v3.mp4',
    localId: 'video-cip50055-respect-elders-5q-voiced-v3',
    cloudOld: 'res_cip50055_respect_elders_video_2q_voiced_v2_20261013',
    title: '尊重长辈｜有声字幕阅读与五题理解（出版社原声）',
    role: 'part_3_traditional_customs', topic: 'topic_132', gradeNumber: 3,
    questions: [
      ['What does Nezha’s mother say to welcome Leo?', ['Welcome to my home.', 'See you tomorrow.', 'Good night.'], 'Welcome to my home.', 'Her greeting appears at the beginning of the visit.', ['Welcome to my home.']],
      ['What does Leo say about the house?', ['It is beautiful.', 'It is very small.', 'It is noisy.'], 'It is beautiful.', 'Leo calls the house beautiful.', ['Your house is so beautiful.']],
      ['Who is not there yet when it is time to eat?', ['Grandpa and Grandma', 'Leo', 'Nezha’s mother'], 'Grandpa and Grandma', 'The children say Grandpa and Grandma have not arrived.', ['Grandpa and grandma are not here yet.']],
      ['What do the children decide to do before eating?', ['Wait for Grandpa and Grandma', 'Leave the house', 'Start without them'], 'Wait for Grandpa and Grandma', 'They agree to wait after noticing the grandparents are absent.', ["Let's wait for them okay?"]],
      ['Who eats first at this family meal?', ['Older family members', 'The children', 'The first guest to arrive'], 'Older family members', 'The family in the video lets older people eat first.', ['In China we let older people eat first.']],
    ],
  },
];
const overridesPath = join(root, 'config/resource-overrides.json');
const overrides = JSON.parse(await readFile(overridesPath, 'utf8'));
for (const spec of specs) {
  const from = join(base, spec.source);
  const to = join(base, spec.target);
  await mkdir(to, { recursive: true });
  const oldVideo = await readFile(join(from, spec.oldName));
  const newVideo = join(to, spec.newName);
  await immutable(newVideo, oldVideo);
  const oldLesson = JSON.parse(await readFile(join(from, `lesson-content-${spec.previous}.json`), 'utf8'));
  const oldReview = await readFile(join(from, `codex-content-review-${spec.previous}.json`));
  const rights = await readFile(join(from, `source-use-decision-${spec.previous}.json`));
  const technical = await readFile(join(from, `technical-output-${spec.previous}.json`));
  const audio = await readFile(join(from, `audio-preservation-${spec.previous}.json`));
  const sourceVideo = await readFile(join(base, `v1/media/video/${oldLesson.sourceVideoId}.mp4`));
  if (hash(oldVideo) !== oldLesson.outputVideoSha256 || hash(sourceVideo) !== oldLesson.sourceVideoSha256) throw new Error('SOURCE_HASH_CONFLICT');
  await immutable(join(to, `source-use-decision-${spec.version}.json`), rights);
  await immutable(join(to, `technical-output-${spec.version}.json`), technical);
  await immutable(join(to, `audio-preservation-${spec.version}.json`), audio);
  const reuse = {
    schemaVersion: 1, createdAt: now, reuseMode: 'byte_identical_verified_voiced_media',
    sourcePath: join(from, spec.oldName), outputPath: newVideo,
    sourceAndOutputSha256: hash(oldVideo), sourceVideoSha256: hash(sourceVideo),
    priorTechnicalReceiptSha256: hash(technical), priorAudioPreservationReceiptSha256: hash(audio),
    note: 'No new transcode or audio claim. The five-question revision changes lesson metadata only.',
  };
  const reuseBytes = json(reuse);
  await immutable(join(to, `media-reuse-${spec.version}.json`), reuseBytes);
  const lesson = {
    ...oldLesson, createdAt: now,
    packageId: oldLesson.packageId.replace('2q', '5q').replace(spec.previous, spec.version),
    learningObjective: oldLesson.learningObjective + ' 完成五道按视频情节顺序设计的理解题。',
    questions: spec.questions.map((item, index) => ({
      id: `cip50055-${oldLesson.sourceVideoId}-q${index + 1}-${spec.version}`,
      type: 'single_choice', stem: item[0], options: item[1],
      correctAnswer: item[2], explanation: item[3], visibleEvidence: item[4],
    })),
    completionRule: { watchedFractionAtLeast: 0.9, answerAllQuestions: true },
    priorLessonSha256: hash(await readFile(join(from, `lesson-content-${spec.previous}.json`))),
  };
  if (lesson.questions.length !== 5 || new Set(lesson.questions.map(q => q.stem)).size !== 5
      || lesson.questions.some(q => !q.options.includes(q.correctAnswer) || !q.visibleEvidence.length)) throw new Error('QUESTION_REVIEW_GATE');
  const lessonBytes = json(lesson);
  await immutable(join(to, `lesson-content-${spec.version}.json`), lessonBytes);
  const review = {
    schemaVersion: 1, reviewRevision: 1, reviewerId: 'Codex', reviewedAt: now,
    decision: 'approved_source_soundtrack_preserved_for_nonproduction_validation',
    productionReady: false,
    sourcePage: 'https://qr.cip.com.cn/html/qrcode/xiaoma/index.html?isbn=50055',
    sourceVideoSha256: hash(sourceVideo), outputVideoSha256: hash(oldVideo),
    outputTechnicalReceiptSha256: hash(technical), audioPreservationReceiptSha256: hash(audio),
    sourceUseDecisionSha256: hash(rights), lessonContentSha256: hash(lessonBytes),
    mediaReuseReceiptSha256: hash(reuseBytes), priorReviewSha256: hash(oldReview),
    questionEvidence: lesson.questions.map(q => ({ id: q.id, caption: q.visibleEvidence, answer: q.correctAnswer })),
    contentReview: 'Five distinct questions follow the visible story in sequence; each correct answer is directly supported by the recorded on-screen caption. Publisher short-video AAC preservation uses the previously verified byte-identical media. This is not a human audition or a transcript review of the separate MP3.',
    studentCompletion: `Watch at least 90% of the ${lesson.durationMs} ms video and answer all five questions.`,
    studentVisibleAttribution: true, supersedesNonproductionResource: spec.cloudOld,
    remainingChecks: ['nonproduction signed playback and five-question task flow', 'production target and resource-specific rights decision', 'real-device audiovisual playback', 'separate book MP3 transcript review'],
  };
  const reviewBytes = json(review);
  await immutable(join(to, `codex-content-review-${spec.version}.json`), reviewBytes);
  const inbox = join(root, 'inbox/cip-50055-reviewed-video-2026-10-13', spec.inboxName);
  await immutable(inbox, oldVideo);
  const localReview = {
    schemaVersion: 1, resourceId: spec.localId, sourceVersion: 1,
    sourceSha256: hash(oldVideo), reviewRevision: 1, reviewerId: 'Codex',
    reviewedAt: now, decision: 'approved', copyrightStatus: 'demo', contentType: 'video',
    contentRole: 'publisher_voiced_bilingual_subtitle_reading_with_five_questions',
    sourceUseDecisionSha256: hash(rights), lessonContentSha256: hash(lessonBytes),
    contentReviewSha256: hash(reviewBytes), mediaReuseReceiptSha256: hash(reuseBytes),
    audioPreservationReceiptSha256: hash(audio), technicalReceiptSha256: hash(technical),
    studentVisibleAttribution: true,
    studentCompletion: `watch_at_least_90_percent_of_${lesson.durationMs}_ms_and_answer_five_questions`,
    productionReady: false,
    productionBlockers: ['resource_specific_production_use_basis', 'real_device_audiovisual_playback', 'separate_book_mp3_transcript_review'],
    technicalReview: { videoCodec: 'h264', audioCodec: 'aac', scanStatus: 'passed', durationMs: lesson.durationMs, originalSoundtrackCorrelation: lesson.publisherVideoSoundtrack.fullSoundtrackCorrelation },
    contentReviewMethod: review.contentReview,
  };
  await immutable(join(root, 'library/media', spec.localId, 'v1/review/approved-content-v1.json'), json(localReview));
  const override = {
    resourceId: spec.localId, title: spec.title, publisher: '化学工业出版社有限公司',
    series: lesson.part, grade: spec.gradeNumber, language: 'en-CN',
    roles: ['video_subtitle_reading', 'video_comprehension_5q', 'publisher_original_soundtrack', spec.role, spec.topic, 'codex_reviewed_nonproduction'],
    rightsStatus: 'project_lead_nonproduction_demo', visibility: 'unassigned',
    needsMetadata: ['production_usage_basis', 'real_device_av_playback', 'companion_mp3_transcript_review'],
  };
  if (overrides.files[spec.inboxName] && JSON.stringify(overrides.files[spec.inboxName]) !== JSON.stringify(override)) throw new Error('OVERRIDE_CONFLICT');
  overrides.files[spec.inboxName] = override;
  process.stdout.write(JSON.stringify({ resourceId: spec.localId, mediaSha256: hash(oldVideo), lessonSha256: hash(lessonBytes), reviewSha256: hash(reviewBytes), questionCount: 5 }) + '\n');
}
await writeFile(overridesPath, json(overrides));
