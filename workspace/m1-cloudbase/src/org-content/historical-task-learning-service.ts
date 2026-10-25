import type { TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabaseReaderPort, VersionedDocument } from '../repositories/document-database-port';
import type { CloudBasePlaybackSdkPort } from '../student-work/cloudbase-playback';
import { findHistoricalTaskLearningItem } from './historical-task-learning';
import { hasCompletePublicLearningMapping } from './public-learning-source';

export class HistoricalTaskLearningError extends Error {
  public constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'SERVICE_UNAVAILABLE') {
    super(code);
  }
}
type Row = Record<string, unknown>;
function object(value: unknown): Row | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
}
function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(object).filter((row): row is Row => row !== null) : [];
}

/** Signs only file IDs found in the server-frozen item of the caller's own task. */
export class HistoricalTaskLearningService {
  public constructor(private readonly database: DocumentDatabaseReaderPort,
    private readonly storage: CloudBasePlaybackSdkPort,
    private readonly clock: Readonly<{ nowIso(): string }>) {}

  public async get(actor: TrustedActorContext, taskId: string, itemId: string): Promise<Readonly<{
    taskId: string; itemId: string; resourceId: string; contentVersion: string;
    reading?: Record<string, unknown>; vocabulary?: Record<string, unknown>;
    audioMaps?: readonly Record<string, unknown>[];
    pronunciation?: Record<string, unknown>;
  }>> {
    if (actor.actorRole !== 'student' || !actor.sessionId) throw new HistoricalTaskLearningError('FORBIDDEN');
    const item = await findHistoricalTaskLearningItem(this.database,
      actor.organizationId, actor.actorUserId, { taskId, itemId });
    if (!item) throw new HistoricalTaskLearningError('NOT_FOUND');
    const origin = object(item.payload.assetLibrary);
    const publicSourceApproved = typeof origin?.sourcePublicId === 'string'
      && origin.reviewStatus === 'approved' && origin.catalogScope === 'all_teachers';
    if (item.type === 'vocabulary' && !publicSourceApproved) throw new HistoricalTaskLearningError('NOT_FOUND');
    const snapshot: VersionedDocument = { _id: item.resourceId, organizationId: actor.organizationId,
      schemaVersion: 1, version: 1, deletedAt: null, type: item.type,
      status: 'published', contentVersion: item.contentVersion, payload: item.payload };
    if (publicSourceApproved && !hasCompletePublicLearningMapping(snapshot)) {
      throw new HistoricalTaskLearningError('NOT_FOUND');
    }
    const fileIds = new Set<string>();
    if (item.type === 'reading') {
      for (const chapter of rows(item.payload.chapters)) {
        for (const page of rows(chapter.pages)) {
          fileIds.add(String(page.imageAssetKey)); fileIds.add(String(page.thumbnailAssetKey));
        }
      }
      if (isReadingMediaAvailable(item.payload.readingAudio, item.contentVersion, item.payload.testOnly === true,
        item.payload.acceptanceStatus)) {
        for (const chapter of rows(object(item.payload.readingAudio)?.chapters)) {
          fileIds.add(String(chapter.audioAssetKey));
          for (const segment of rows(chapter.segments)) {
            if (typeof segment.clipAudioAssetKey === 'string') fileIds.add(segment.clipAudioAssetKey);
          }
        }
      }
      if (isApprovedPronunciation(item.payload.pronunciation, item.contentVersion)) {
        for (const segment of rows(object(item.payload.pronunciation)?.segments)) {
          if (typeof segment.demonstrationAudioAssetKey === 'string') {
            fileIds.add(segment.demonstrationAudioAssetKey);
          }
        }
      }
    } else {
      for (const word of rows(item.payload.words)) fileIds.add(String(word.audioAssetKey));
    }
    if (!fileIds.size || fileIds.size > 1200
      || [...fileIds].some(id => !id.startsWith('cloud://'))) {
      throw new HistoricalTaskLearningError('NOT_FOUND');
    }
    const signed = new Map<string, string>();
    const ids = [...fileIds];
    for (let offset = 0; offset < ids.length; offset += 20) {
      const batch = ids.slice(offset, offset + 20);
      const result = await this.storage.getTempFileURL({
        fileList: batch.map(fileID => ({ fileID, maxAge: 3600 })),
      });
      for (const fileID of batch) {
        const link = result.fileList?.find(entry => entry.fileID === fileID);
        if (!link?.tempFileURL?.startsWith('https://')
          || link.code !== undefined && link.code !== 'SUCCESS') {
          throw new HistoricalTaskLearningError('SERVICE_UNAVAILABLE');
        }
        signed.set(fileID, link.tempFileURL);
      }
    }
    const expiresAt = new Date(Date.parse(this.clock.nowIso()) + 3_600_000).toISOString();
    const base = { taskId: item.taskId, itemId: item.itemId,
      resourceId: item.resourceId, contentVersion: item.contentVersion };
    if (item.type === 'vocabulary') {
      return { ...base, vocabulary: {
        id: item.resourceId, title: item.title, grade: text(item.payload.grade),
        unit: text(item.payload.unit), contentVersion: item.contentVersion,
        words: rows(item.payload.words).map(word => ({
          id: word.id, word: word.word, meaning: word.meaning,
          example: word.example, syllables: word.syllables,
          ...(typeof word.ipa === 'string' && /^\/[^/]{1,120}\/$/u.test(word.ipa)
            ? { ipa: word.ipa } : {}),
          pronunciationUrl: signed.get(String(word.audioAssetKey)),
          pronunciationExpiresAt: expiresAt,
        })),
      } };
    }
    const chapters = rows(item.payload.chapters).map(chapter => ({
      id: chapter.id, title: chapter.title, order: chapter.order,
      pages: rows(chapter.pages).map(page => ({
        id: page.id, pageNumber: page.pageNumber, order: page.order,
        imageAssetKey: signed.get(String(page.imageAssetKey)),
        thumbnailAssetKey: signed.get(String(page.thumbnailAssetKey)),
        width: page.width, height: page.height, assetVersion: page.assetVersion,
      })),
    }));
    const readingAudio = isReadingMediaAvailable(item.payload.readingAudio, item.contentVersion,
      item.payload.testOnly === true, item.payload.acceptanceStatus) ? object(item.payload.readingAudio) : null;
    const audioMaps = rows(readingAudio?.chapters).map(chapter => ({
      resourceId: item.resourceId, sourceVersion: item.contentVersion,
      chapterId: chapter.chapterId, durationMs: chapter.durationMs,
      playback: { temporaryUrl: signed.get(String(chapter.audioAssetKey)), expiresAt },
      segments: rows(chapter.segments).map(segment => ({
        id: segment.id, pageId: segment.pageId, pageNumber: segment.pageNumber,
        text: segment.text, rect: segment.rect,
        startMs: segment.startMs, endMs: segment.endMs,
        ...(typeof segment.clipAudioAssetKey === 'string'
          ? { clipDurationMs: segment.clipDurationMs,
            clipPlayback: { temporaryUrl: signed.get(segment.clipAudioAssetKey), expiresAt } } : {}),
      })),
    }));
    const pronunciation = isApprovedPronunciation(item.payload.pronunciation, item.contentVersion)
      ? object(item.payload.pronunciation) : null;
    return { ...base, reading: {
      id: item.resourceId, title: item.title, type: 'reading',
      category: text(item.payload.category) || 'picture_book',
      grade: text(item.payload.grade), difficulty: text(item.payload.difficulty) || '基础',
      contentVersion: item.contentVersion, presentation: 'page_images_only',
      textVisibility: { ocrExposed: false, standaloneBodyExposed: false }, chapters,
    }, audioMaps, ...(pronunciation ? { pronunciation: {
      resourceId: item.resourceId, sourceVersion: item.contentVersion,
      segments: rows(pronunciation.segments).map(segment => ({
        id: segment.id, text: segment.text, pageNumber: segment.pageNumber,
        ...(typeof segment.translationText === 'string' && segment.translationText.trim()
          ? { translationText: segment.translationText } : {}),
        demonstrationAudio: { temporaryUrl: signed.get(String(segment.demonstrationAudioAssetKey)),
          expiresAt },
      })),
    } } : {}) };
  }
}
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }

function isReadingMediaAvailable(value: unknown, contentVersion: string, testOnly: boolean,
  acceptanceStatus: unknown): boolean {
  const media = object(value);
  if (!media || media.sourceVersion !== contentVersion) return false;
  const reviewed = media.reviewStatus === 'approved' && typeof media.approvedBy === 'string'
    && typeof media.approvedAt === 'string' && Number.isFinite(Date.parse(media.approvedAt));
  const userAcceptance = testOnly && acceptanceStatus === 'pending_user_acceptance'
    && media.reviewStatus === 'pending_user_acceptance';
  return reviewed || userAcceptance;
}

function isApprovedPronunciation(value: unknown, contentVersion: string): boolean {
  const media = object(value);
  return Boolean(media && media.sourceVersion === contentVersion && media.reviewStatus === 'approved'
    && typeof media.approvedBy === 'string' && typeof media.approvedAt === 'string'
    && Number.isFinite(Date.parse(media.approvedAt)));
}
