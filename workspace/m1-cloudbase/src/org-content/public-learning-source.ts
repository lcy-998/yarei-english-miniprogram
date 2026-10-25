import { createHash } from 'node:crypto';
import type { DocumentDatabaseReaderPort, VersionedDocument } from '../repositories/document-database-port';

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
function sha(value: unknown): boolean {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}
function cloudKey(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('cloud://') && value.length > 8;
}
function field(document: VersionedDocument, name: string): unknown {
  return document[name] ?? object(document.payload)?.[name];
}
function approvedOrigin(document: VersionedDocument): Record<string, unknown> | null {
  const origin = object(object(document.payload)?.assetLibrary);
  return origin?.kind === 'central_asset_library' && origin.catalogScope === 'all_teachers'
    && origin.reviewStatus === 'approved' && origin.resourceId === document._id
    && origin.version === document.contentVersion
    && sha(origin.sourceSha256) && sha(origin.manifestSha256)
    && sha(origin.copyrightEvidenceSha256)
    && typeof origin.reviewId === 'string' && origin.reviewId.length > 0
    ? origin : null;
}

/** Raw content validation is independent of the client-visible directory. */
export function hasCompletePublicLearningMapping(document: VersionedDocument): boolean {
  if (document.type === 'vocabulary') {
    const words = list(field(document, 'words'));
    return words.length > 0 && words.every(value => {
      const word = object(value);
      return !!word && typeof word.id === 'string' && typeof word.word === 'string'
        && word.word.trim().length > 0 && typeof word.meaning === 'string'
        && typeof word.example === 'string' && cloudKey(word.audioAssetKey)
        && list(word.syllables).length > 0
        && list(word.syllables).every(part => typeof part === 'string' && part.trim().length > 0);
    });
  }
  if (document.type !== 'reading') return false;
  const chapters = list(field(document, 'chapters')).map(object);
  const payload = object(document.payload);
  const audioMode = field(document, 'audioMode');
  if (audioMode === 'page_only' || audioMode === 'chapter_audio'
    || audioMode === 'partial_pointread') {
    const note = field(document, 'audioAvailabilityNote');
    const pageOnlyNote = '点读、跟读与示范音频暂未开放';
    const chapterAudioNote = '已开放章节朗读；点读、跟读与示范音频暂未开放';
    const partialNote = '已开放部分课文点读与跟读；其余章节可连听，未标注页面暂未开放';
    const expectedNote = audioMode === 'page_only' ? pageOnlyNote
      : audioMode === 'chapter_audio' ? chapterAudioNote : partialNote;
    if (note !== expectedNote
      || !chapters.length) return false;
    const pages = chapters.flatMap(chapter => list(chapter?.pages).map(object));
    const numbers = pages.map(page => page?.pageNumber);
    const pageMappingReady = pages.length > 0 && pages.every(page => !!page
      && typeof page.id === 'string' && page.id.trim().length > 0
      && cloudKey(page.imageAssetKey) && cloudKey(page.thumbnailAssetKey)
      && Number.isSafeInteger(page.pageNumber) && Number(page.pageNumber) >= 1
      && typeof page.role === 'string')
      && new Set(pages.map(page => page?.id)).size === pages.length
      && new Set(numbers).size === pages.length
      && [...numbers].sort((a, b) => Number(a) - Number(b))
        .every((number, index) => number === index + 1)
      && payload?.audioMode === audioMode
      && payload.audioAvailabilityNote === note;
    if (!pageMappingReady || audioMode === 'page_only') return pageMappingReady;
    const audio = object(field(document, 'readingAudio'));
    const audioChapters = list(audio?.chapters).map(object);
    const expectedIds = chapters.filter(chapter => typeof chapter?.title === 'string'
      && /^(?:Starter )?Unit \d+|^Revision/u.test(String(chapter.title)))
      .map(chapter => chapter?.id);
    const baseAudioReady = audio?.reviewStatus === 'approved'
      && audio.sourceVersion === document.contentVersion
      && typeof audio.approvedBy === 'string' && audio.approvedBy.length > 0
      && typeof audio.approvedAt === 'string' && Number.isFinite(Date.parse(audio.approvedAt))
      && audioChapters.length === expectedIds.length
      && new Set(audioChapters.map(chapter => chapter?.chapterId)).size === audioChapters.length
      && expectedIds.every(id => audioChapters.some(chapter => chapter?.chapterId === id))
      && audioChapters.every(chapter => !!chapter && cloudKey(chapter.audioAssetKey)
        && Number.isSafeInteger(chapter.durationMs) && Number(chapter.durationMs) >= 1000
        && Array.isArray(chapter.segments));
    if (!baseAudioReady) return false;
    if (audioMode === 'chapter_audio') {
      return audioChapters.every(chapter => Array.isArray(chapter?.segments)
        && chapter.segments.length === 0);
    }
    const mappedPages = new Map(chapters.map(chapter => [chapter?.id,
      new Map(list(chapter?.pages).map(page => {
        const value = object(page);
        return [value?.id, value?.pageNumber];
      }))]));
    const segments = audioChapters.flatMap(chapter => list(chapter?.segments).map(object)
      .map(segment => ({ chapterId: chapter?.chapterId, segment })));
    if (!segments.length || segments.some(({ chapterId, segment }) => {
      const rect = object(segment?.rect);
      return !segment || mappedPages.get(chapterId)?.get(segment.pageId) !== segment.pageNumber
        || typeof segment.id !== 'string' || typeof segment.text !== 'string'
        || !segment.text.trim() || segment.text.length > 300
        || !cloudKey(segment.clipAudioAssetKey)
        || !Number.isSafeInteger(segment.clipDurationMs) || Number(segment.clipDurationMs) < 1000
        || !Number.isSafeInteger(segment.startMs) || !Number.isSafeInteger(segment.endMs)
        || Number(segment.startMs) < 0 || Number(segment.startMs) >= Number(segment.endMs)
        || Number(segment.endMs) > Number(segment.clipDurationMs)
        || !rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
        || Number(rect.x) < 0 || Number(rect.y) < 0
        || Number(rect.width) <= 0 || Number(rect.height) <= 0
        || Number(rect.x) + Number(rect.width) > 1
        || Number(rect.y) + Number(rect.height) > 1;
    })) return false;
    const pronunciation = object(field(document, 'pronunciation'));
    const spoken = list(pronunciation?.segments).map(object);
    return pronunciation?.reviewStatus === 'approved'
      && pronunciation.sourceVersion === document.contentVersion
      && typeof pronunciation.approvedBy === 'string' && pronunciation.approvedBy.length > 0
      && typeof pronunciation.approvedAt === 'string'
      && Number.isFinite(Date.parse(pronunciation.approvedAt))
      && spoken.length === segments.length
      && new Set(spoken.map(segment => segment?.id)).size === spoken.length
      && segments.every(({ segment }) => spoken.some(item => item?.id === segment?.id
        && item?.pageNumber === segment?.pageNumber && item?.text === segment?.text
        && (item?.translationText === undefined || typeof item.translationText === 'string')
        && item?.demonstrationAudioAssetKey === segment?.clipAudioAssetKey));
  }
  const audio = object(field(document, 'readingAudio'));
  if (!chapters.length || !audio || audio.reviewStatus !== 'approved'
    || String(audio.sourceVersion) !== String(document.contentVersion)
    || typeof audio.approvedBy !== 'string' || !audio.approvedBy.trim()
    || !Number.isFinite(Date.parse(String(audio.approvedAt)))
    || list(audio.chapters).length !== chapters.length) return false;
  const audioByChapter = new Map(list(audio.chapters).map(item => {
    const entry = object(item);
    return [entry?.chapterId, entry] as const;
  }));
  if (audioByChapter.size !== chapters.length) return false;
  return chapters.every(chapter => {
    const pages = list(chapter?.pages).map(object);
    const mapped = audioByChapter.get(chapter?.id);
    if (!chapter || !pages.length || !mapped || !cloudKey(mapped.audioAssetKey)
      || !Number.isSafeInteger(mapped.durationMs) || Number(mapped.durationMs) < 1000) return false;
    const pageIds = new Set(pages.map(page => page?.id));
    if (pageIds.size !== pages.length || pages.some(page => !page
      || !cloudKey(page.imageAssetKey) || !cloudKey(page.thumbnailAssetKey)
      || !Number.isSafeInteger(page.pageNumber))) return false;
    const segments = list(mapped.segments).map(object);
    const contentPages = pages.filter(page => page?.role !== 'cover' && page?.role !== 'credits');
    return contentPages.length > 0 && segments.length >= contentPages.length
      && contentPages.every(page => segments.some(segment => segment?.pageId === page?.id))
      && segments.every(segment => !!segment && pageIds.has(segment.pageId)
        && typeof segment.text === 'string' && segment.text.trim().length > 0
        && Number.isSafeInteger(segment.startMs) && Number.isSafeInteger(segment.endMs)
        && Number(segment.startMs) >= 0 && Number(segment.startMs) < Number(segment.endMs)
        && (segment.clipAudioAssetKey === undefined
          ? Number(segment.endMs) <= Number(mapped.durationMs)
          : cloudKey(segment.clipAudioAssetKey) && Number.isSafeInteger(segment.clipDurationMs)
            && Number(segment.endMs) <= Number(segment.clipDurationMs)));
  });
}

export function publicLearningContentSha256(document: VersionedDocument): string {
  const payload = object(document.payload);
  const safePayload = payload ? { ...payload } : null;
  if (safePayload) delete safePayload.assetLibrary;
  return createHash('sha256').update(JSON.stringify({
    type: document.type, title: document.title, contentVersion: document.contentVersion,
    grade: field(document, 'grade'), term: field(document, 'term'),
    textbook: field(document, 'textbook'), unit: field(document, 'unit'),
    category: field(document, 'category'), difficulty: field(document, 'difficulty'),
    chapters: field(document, 'chapters'), readingAudio: field(document, 'readingAudio'),
    pronunciation: field(document, 'pronunciation'), words: field(document, 'words'),
    payload: safePayload,
  })).digest('hex');
}

export function isVerifiedPublicLearningSource(document: VersionedDocument | null): document is VersionedDocument {
  if (!document || (document.type !== 'reading' && document.type !== 'vocabulary')
    || document.publicCatalogSource !== true || document.teacherCatalogOnly !== true
    || document.status !== 'published' || document.deletedAt !== null
    || document.copyrightStatus !== 'verified'
    || !(typeof document.contentVersion === 'string' && document.contentVersion.trim()
      || Number.isSafeInteger(document.contentVersion) && Number(document.contentVersion) >= 1)
    || object(document.visibility)?.type !== 'organization'
    || !hasCompletePublicLearningMapping(document)) return false;
  const origin = approvedOrigin(document);
  return !!origin && origin.contentSha256 === publicLearningContentSha256(document);
}

/** A local projection stops serving as soon as its central source goes offline or changes. */
export async function hasActivePublicLearningSource(reader: DocumentDatabaseReaderPort,
  document: VersionedDocument): Promise<boolean> {
  if (document.type !== 'reading' && document.type !== 'vocabulary') return true;
  const origin = object(object(document.payload)?.assetLibrary);
  if (document.publicLearningProjection !== true && origin?.sourcePublicId === undefined) return true;
  const sourceId = origin?.sourcePublicId;
  if (document.publicLearningProjection !== true || document.teacherCatalogOnly !== true
    || typeof sourceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(sourceId)
    || sourceId === document._id || document.status !== 'published'
    || document.deletedAt !== null) return false;
  const source = await reader.get('learning_resources', sourceId);
  if (!isVerifiedPublicLearningSource(source)) return false;
  const sourceOrigin = object(object(source.payload)?.assetLibrary);
  return !!sourceOrigin && !!origin && origin.manifestSha256 === sourceOrigin.manifestSha256
    && origin.sourceSha256 === sourceOrigin.sourceSha256
    && origin.version === sourceOrigin.version
    && origin.contentSha256 === sourceOrigin.contentSha256
    && publicLearningContentSha256(document) === publicLearningContentSha256(source);
}
