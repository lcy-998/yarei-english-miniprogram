import type { VersionedDocument } from '../repositories/document-database-port';
import { hasApprovedAssetLibraryOrigin } from './asset-library-origin';
import type { JsonObject } from '../shared/protocol';
import { freezeTeacherMediaForTask, type TeacherMediaCandidate } from './publish-gate';

export interface CentralMediaImportInput {
  readonly resourceId: string;
  readonly organizationId: string;
  readonly contentVersion: number;
  readonly manifestSha256: string;
  readonly reviewId: string;
  readonly importedBy: string;
  readonly grade: string;
  readonly textbook?: string;
  readonly unit?: string;
  readonly visibility: Readonly<{ type: 'classes'; classIds: readonly string[] }>
    | Readonly<{ type: 'organization' }>;
  readonly processedMedia: TeacherMediaCandidate;
}

export class CentralMediaImportError extends Error {
  public constructor(public readonly code: 'VALIDATION_ERROR' | 'MEDIA_INVALID') { super(code); }
}

export interface VerifiedCentralMediaInput extends Omit<CentralMediaImportInput, 'visibility'> {
  readonly sourceSha256: string;
  readonly verifiedAt: string;
  readonly releaseMode?: 'user_acceptance' | 'formal_reusable';
}

/** Nonproduction controlled import. A passing package is immediately teacher-selectable. */
export function buildVerifiedCentralMediaResource(input: VerifiedCentralMediaInput): VersionedDocument {
  const media = input.processedMedia;
  const formal = input.releaseMode === 'formal_reusable';
  if (!validId(input.resourceId) || !validId(input.organizationId)
    || !validId(input.reviewId) || !validId(input.importedBy)
    || !Number.isSafeInteger(input.contentVersion) || input.contentVersion < 1
    || !/^[a-f0-9]{64}$/i.test(input.manifestSha256)
    || !/^[a-f0-9]{64}$/i.test(input.sourceSha256)
    || !Number.isFinite(Date.parse(input.verifiedAt))
    || typeof input.grade !== 'string' || !input.grade.trim() || media.id !== input.resourceId
    || media.organizationId !== input.organizationId || media.version !== input.contentVersion
    || (input.releaseMode !== undefined && input.releaseMode !== 'user_acceptance' && !formal)
    || !['listening', 'video', 'dubbing'].includes(media.kind)) {
    throw new CentralMediaImportError('VALIDATION_ERROR');
  }
  const readyMedia: TeacherMediaCandidate = { ...media, catalogScope: 'all_teachers',
    status: 'published', reviewVersion: media.version,
    reviewedBy: 'controlled_import', reviewedAt: input.verifiedAt,
    copyrightStatus: 'verified' };
  const probe = freezeTeacherMediaForTask(readyMedia, input.organizationId, ['controlled_import_probe']);
  if (!probe.ready) throw new CentralMediaImportError('MEDIA_INVALID');
  return { _id: input.resourceId, organizationId: input.organizationId,
    schemaVersion: 1, version: 1, deletedAt: null,
    type: media.kind, title: media.title, contentVersion: input.contentVersion,
    status: 'published', publicCatalogSource: true, grade: input.grade,
    copyrightStatus: 'verified', testOnly: !formal,
    ...(formal ? {} : { acceptanceStatus: 'pending_user_acceptance' }),
    ...(input.textbook === undefined ? {} : { textbook: input.textbook }),
    ...(input.unit === undefined ? {} : { unit: input.unit }),
    visibility: { type: 'organization' },
    payload: { assetLibrary: { kind: 'central_asset_library', resourceId: input.resourceId,
      version: input.contentVersion, manifestSha256: input.manifestSha256,
      sourceSha256: input.sourceSha256, reviewId: input.reviewId,
      importedBy: input.importedBy,
      reviewStatus: formal ? 'source_verified_reusable' : 'user_acceptance',
      ...(formal ? { verificationScope: 'nonproduction_reusable', automatedVerifier: 'codex',
        testOnly: false } : { acceptanceScope: 'nonproduction_virtual',
        acceptanceStatus: 'pending_user_acceptance', automatedVerifier: 'codex', testOnly: true }) },
    teacherMedia: JSON.parse(JSON.stringify(readyMedia)) as Record<string,
      import('../shared/protocol').JsonValue> },
  };
}

/** Creates an isolated school projection of an explicitly public, verified central asset. */
export function projectPublicMediaForOrganization(source: VersionedDocument,
  organizationId: string, resourceId: string): VersionedDocument {
  const payload = isObject(source.payload) ? source.payload as JsonObject : null;
  const origin = payload && isObject(payload.assetLibrary) ? payload.assetLibrary : null;
  const media = payload && isObject(payload.teacherMedia) ? payload.teacherMedia : null;
  if (!validId(organizationId) || !validId(resourceId) || !payload || !origin || !media
    || source.status !== 'published' || source.publicCatalogSource !== true
    || !Number.isSafeInteger(source.contentVersion)
    || media.id !== source._id || media.organizationId !== source.organizationId
    || media.kind !== source.type || media.title !== source.title
    || !hasApprovedAssetLibraryOrigin(payload, source._id, Number(source.contentVersion))
    || !((origin.reviewStatus === 'source_verified_reusable' && origin.testOnly === false
      && source.testOnly === false && source.acceptanceStatus !== 'pending_user_acceptance')
      || (origin.reviewStatus === 'user_acceptance'
      && origin.acceptanceScope === 'nonproduction_virtual' && origin.testOnly === true))
    || media.catalogScope !== 'all_teachers'
    || !isObject(source.visibility) || source.visibility.type !== 'organization') {
    throw new CentralMediaImportError('VALIDATION_ERROR');
  }
  const projectedMedia = { ...media, id: resourceId, organizationId,
    catalogScope: 'all_teachers' } as unknown as TeacherMediaCandidate;
  const probe = freezeTeacherMediaForTask(projectedMedia, organizationId,
    ['controlled_import_probe']);
  if (!probe.ready) throw new CentralMediaImportError('MEDIA_INVALID');
  return { ...source, _id: resourceId, organizationId, version: 1,
    publicCatalogSource: false,
    payload: { ...payload, assetLibrary: { ...origin,
      resourceId, sourcePublicId: source._id },
    teacherMedia: JSON.parse(JSON.stringify(projectedMedia)) as JsonObject } };
}

/** Builds a reviewable CloudBase draft from a server-side asset-library package. It performs no upload or write. */
export function buildCentralMediaDraft(input: CentralMediaImportInput): VersionedDocument {
  const media = input.processedMedia;
  if (!validId(input.resourceId) || !validId(input.organizationId)
    || !validId(input.reviewId) || !validId(input.importedBy)
    || !Number.isSafeInteger(input.contentVersion) || input.contentVersion < 1
    || !/^[a-f0-9]{64}$/i.test(input.manifestSha256)
    || typeof input.grade !== 'string' || !input.grade.trim()
    || !Array.isArray(media.allowedClassIds) || !media.allowedClassIds.length
    || media.allowedClassIds.some(id => !validId(id))
    || input.visibility.type === 'classes' && (!input.visibility.classIds.length
      || input.visibility.classIds.some(id => !media.allowedClassIds.includes(id)))
    || media.id !== input.resourceId || media.organizationId !== input.organizationId
    || media.version !== input.contentVersion
    || !['listening', 'video', 'dubbing'].includes(media.kind)) {
    throw new CentralMediaImportError('VALIDATION_ERROR');
  }
  const probe = freezeTeacherMediaForTask({ ...media, status: 'published',
    reviewVersion: media.version, reviewedBy: 'technical-preflight',
    reviewedAt: '2026-10-03T00:00:00.000Z', copyrightStatus: 'verified' },
  input.organizationId, input.visibility.type === 'classes'
    ? input.visibility.classIds : [media.allowedClassIds[0]!]);
  if (!probe.ready) throw new CentralMediaImportError('MEDIA_INVALID');
  return { _id: input.resourceId, organizationId: input.organizationId,
    schemaVersion: 1, version: 1, deletedAt: null,
    type: media.kind, title: media.title, contentVersion: input.contentVersion,
    status: 'draft', grade: input.grade,
    ...(input.textbook === undefined ? {} : { textbook: input.textbook }),
    ...(input.unit === undefined ? {} : { unit: input.unit }),
    visibility: input.visibility.type === 'organization' ? { type: 'organization' }
      : { type: 'classes', classIds: [...input.visibility.classIds] },
    payload: { assetLibrary: { kind: 'central_asset_library', resourceId: input.resourceId,
      version: input.contentVersion, manifestSha256: input.manifestSha256,
      reviewId: input.reviewId, importedBy: input.importedBy, reviewStatus: 'pending' },
    teacherMedia: { allowedClassIds: [...media.allowedClassIds],
      status: 'pending_review', reviewVersion: null, reviewedBy: null, reviewedAt: null,
      copyrightStatus: 'unverified', copyrightEvidenceKey: media.copyrightEvidenceKey,
      scanStatus: media.scanStatus, transcodeStatus: media.transcodeStatus,
      sourceScanEvidence: media.sourceScanEvidence, transcodeEvidence: media.transcodeEvidence,
      scanEvidence: media.scanEvidence, mediaAssetKey: media.mediaAssetKey,
      mediaSha256: media.mediaSha256, durationMs: media.durationMs,
      questionIds: [...media.questionIds], questions: media.questions.map(question => ({
        ...question, options: [...question.options],
      })), answerKeys: media.answerKeys.map(answer => ({ ...answer,
        correctAnswer: Array.isArray(answer.correctAnswer)
          ? [...answer.correctAnswer] : answer.correctAnswer,
      })), clips: media.clips.map(clip => ({ ...clip })),
      ...(media.subtitleAssetKey === undefined ? {} : { subtitleAssetKey: media.subtitleAssetKey }),
      ...(media.subtitleCues === undefined ? {} : { subtitleCues: media.subtitleCues.map(cue => ({ ...cue })) }),
      continuousPlaybackEnforced: media.continuousPlaybackEnforced },
    },
  };
}

function validId(value: string): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
