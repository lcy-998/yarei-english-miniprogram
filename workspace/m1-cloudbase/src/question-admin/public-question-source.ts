import type { DocumentDatabaseReaderPort, VersionedDocument } from '../repositories/document-database-port';

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function hash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

/** A public marker alone never authorizes a legacy or incomplete question. */
export function isVerifiedPublicQuestionSource(source: VersionedDocument | null): source is VersionedDocument {
  if (!source || source.type !== 'exercise' || source.publicCatalogSource !== true
    || source.teacherCatalogOnly !== true
    || source.status !== 'published' || source.deletedAt !== null
    || source.copyrightStatus !== 'verified'
    || !Number.isSafeInteger(source.contentVersion) || Number(source.contentVersion) < 1) return false;
  const payload = object(source.payload);
  const origin = object(payload?.assetLibrary);
  const visibility = object(source.visibility);
  const section = object(payload?.exerciseSection);
  const accepted = payload?.acceptedAnswers;
  const rubric = payload?.rubric;
  if (payload?.exerciseSection !== undefined && (!section || typeof section.id !== 'string'
    || typeof section.title !== 'string' || typeof section.instruction !== 'string'
    || typeof section.studentMaterial !== 'string'
    || !Number.isSafeInteger(section.order) || !Number.isSafeInteger(section.questionOrder)
    || !Number.isSafeInteger(section.points))) return false;
  if (accepted !== undefined && (source.questionType !== 'fill' || !Array.isArray(accepted)
    || !accepted.length || accepted.some(value => typeof value !== 'string')
    || !accepted.includes(source.correctAnswer))) return false;
  if (rubric !== undefined && (source.questionType !== 'subjective' || !Array.isArray(rubric)
    || !rubric.length || rubric.some(value => !object(value)
      || typeof object(value)?.criterion !== 'string'
      || !Number.isSafeInteger(object(value)?.points)))) return false;
  return !!payload && !!origin && visibility?.type === 'organization'
    && origin.kind === 'central_asset_library'
    && origin.resourceId === source._id && origin.version === source.contentVersion
    && typeof origin.exercisePackId === 'string'
    && /^[A-Za-z0-9_-]{1,128}$/u.test(origin.exercisePackId)
    && (origin.reviewStatus === 'approved'
      || origin.reviewStatus === 'source_verified_reusable'
      && origin.verificationScope === 'nonproduction_reusable'
      && origin.automatedVerifier === 'codex' && origin.testOnly === false
      && source.testOnly === false)
    && origin.catalogScope === 'all_teachers'
    && hash(origin.manifestSha256) && hash(origin.sourceSha256)
    && typeof origin.sourceUrl === 'string'
    && (origin.sourceKind === 'original_by_codex'
      ? origin.sourceUrl.startsWith('asset-library://independent-exercises/')
      : origin.sourceUrl.startsWith('https://'))
    && hash(origin.copyrightEvidenceSha256)
    && typeof origin.reviewId === 'string' && origin.reviewId.length > 0
    && typeof origin.copyrightEvidenceId === 'string' && origin.copyrightEvidenceId.length > 0
    && Array.isArray(payload.questionIds) && payload.questionIds.length === 1
    && payload.questionIds[0] === source._id
    && payload.questionType === source.questionType && payload.stem === source.stem
    && JSON.stringify(payload.options) === JSON.stringify(source.options)
    && JSON.stringify(payload.correctAnswer) === JSON.stringify(source.correctAnswer)
    && payload.explanation === source.explanation;
}

/** Projected questions fail closed immediately when the verified source is unavailable or taken down. */
export async function hasActivePublicQuestionSource(reader: DocumentDatabaseReaderPort,
  resource: VersionedDocument): Promise<boolean> {
  if (resource.type !== 'exercise') return true;
  const payload = object(resource.payload);
  const origin = object(payload?.assetLibrary);
  if (resource.publicQuestionProjection !== true && origin?.sourcePublicId === undefined) return true;
  const sourceId = origin?.sourcePublicId;
  if (resource.publicQuestionProjection !== true || typeof sourceId !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(sourceId) || sourceId === resource._id
    || resource.status !== 'published' || resource.deletedAt !== null) return false;
  const source = await reader.get('learning_resources', sourceId);
  if (!isVerifiedPublicQuestionSource(source)) return false;
  const sourceOrigin = object(object(source.payload)?.assetLibrary);
  return !!sourceOrigin && !!origin
    && origin.manifestSha256 === sourceOrigin.manifestSha256
    && origin.sourceSha256 === sourceOrigin.sourceSha256
    && origin.version === sourceOrigin.version
    && resource.contentVersion === source.contentVersion
    && resource.copyrightStatus === 'verified'
    && resource.questionType === source.questionType
    && resource.stem === source.stem
    && JSON.stringify(resource.options) === JSON.stringify(source.options)
    && JSON.stringify(resource.correctAnswer) === JSON.stringify(source.correctAnswer)
    && JSON.stringify(payload?.exerciseSection) === JSON.stringify(object(source.payload)?.exerciseSection)
    && JSON.stringify(payload?.acceptedAnswers) === JSON.stringify(object(source.payload)?.acceptedAnswers)
    && JSON.stringify(payload?.rubric) === JSON.stringify(object(source.payload)?.rubric)
    && resource.explanation === source.explanation
    && Array.isArray(payload?.questionIds) && payload.questionIds.length === 1
    && payload.questionIds[0] === resource._id;
}
