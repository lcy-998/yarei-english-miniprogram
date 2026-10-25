import { createHash } from 'node:crypto';
import type { DocumentDatabasePort, VersionedDocument } from '../repositories/document-database-port';
import type { JsonValue } from '../shared/protocol';
import { isVerifiedPublicQuestionSource } from './public-question-source';

export interface VerifiedPublicQuestionInput {
  readonly sourceId: string;
  readonly organizationId: string;
  readonly title: string;
  readonly grade: string;
  readonly questionType: 'single_choice' | 'multiple_choice' | 'fill' | 'subjective';
  readonly stem: string;
  readonly options: readonly string[];
  readonly correctAnswer: JsonValue;
  readonly explanation: string;
  readonly textbook?: string;
  readonly unit?: string;
  readonly knowledgePoint?: string;
  readonly difficulty?: string;
  readonly contentVersion: number;
  readonly sourceSha256: string;
  readonly sourceUrl: string;
  readonly sourceKind?: 'original_by_codex';
  readonly manifestSha256: string;
  readonly reviewId: string;
  readonly copyrightEvidenceId: string;
  readonly copyrightEvidenceSha256: string;
  readonly verifiedAt: string;
  readonly importedBy: string;
  readonly exercisePackId: string;
  readonly exerciseSection?: Readonly<{ id: string; title: string; instruction: string;
    studentMaterial: string; order: number; questionOrder: number; points: number }>;
  readonly acceptedAnswers?: readonly string[];
  readonly rubric?: readonly Readonly<{ criterion: string; points: number }>[];
}

export class PublicQuestionDistributionError extends Error {
  public constructor(public readonly code: 'VALIDATION_ERROR' | 'CONFLICT' | 'SERVICE_UNAVAILABLE') {
    super(code);
  }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function validText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function validHash(value: unknown): boolean {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function validExerciseSection(value: VerifiedPublicQuestionInput['exerciseSection']): boolean {
  return value === undefined || (validId(value.id) && validText(value.title)
    && validText(value.instruction) && typeof value.studentMaterial === 'string'
    && Number.isSafeInteger(value.order) && value.order > 0
    && Number.isSafeInteger(value.questionOrder) && value.questionOrder > 0
    && Number.isSafeInteger(value.points) && value.points > 0);
}

function validScoringDetails(input: VerifiedPublicQuestionInput): boolean {
  if (input.acceptedAnswers !== undefined && (input.questionType !== 'fill'
    || !Array.isArray(input.acceptedAnswers) || !input.acceptedAnswers.length
    || input.acceptedAnswers.some(answer => !validText(answer))
    || typeof input.correctAnswer !== 'string' || !input.acceptedAnswers.includes(input.correctAnswer))) return false;
  if (input.rubric !== undefined && (input.questionType !== 'subjective'
    || !Array.isArray(input.rubric) || input.rubric.length < 2
    || input.rubric.some(row => !validText(row.criterion)
      || !Number.isSafeInteger(row.points) || row.points < 1)
    || input.exerciseSection === undefined
    || input.rubric.reduce((sum, row) => sum + row.points, 0) !== input.exerciseSection.points)) return false;
  return true;
}

export function publicQuestionProjectionId(sourceId: string, organizationId: string): string {
  return `public_question_${createHash('sha256').update(JSON.stringify([sourceId, organizationId]))
    .digest('hex').slice(0, 40)}`;
}

/** Only a trusted controlled-import caller may supply this verified package. */
export function buildVerifiedPublicQuestionSource(input: VerifiedPublicQuestionInput): VersionedDocument {
  if (![input.sourceId, input.organizationId, input.reviewId, input.copyrightEvidenceId,
    input.importedBy].every(validId)
    || !validText(input.title) || !validText(input.grade) || !validText(input.stem)
    || !validText(input.explanation) || !Array.isArray(input.options)
    || input.options.some(option => typeof option !== 'string')
    || input.correctAnswer === undefined
    || !['single_choice', 'multiple_choice', 'fill', 'subjective'].includes(input.questionType)
    || !Number.isSafeInteger(input.contentVersion) || input.contentVersion < 1
    || !validHash(input.sourceSha256) || !validHash(input.manifestSha256)
    || typeof input.sourceUrl !== 'string'
    || (input.sourceKind === 'original_by_codex'
      ? !input.sourceUrl.startsWith('asset-library://independent-exercises/')
      : !input.sourceUrl.startsWith('https://'))
    || !validHash(input.copyrightEvidenceSha256)
    || !Number.isFinite(Date.parse(input.verifiedAt))
    || !validId(input.exercisePackId) || !validExerciseSection(input.exerciseSection)
    || !validScoringDetails(input)
    || [input.textbook, input.unit, input.knowledgePoint, input.difficulty]
      .some(value => value !== undefined && (typeof value !== 'string' || !value.trim()))
    || (input.exercisePackId !== undefined && !validId(input.exercisePackId))) {
    throw new PublicQuestionDistributionError('VALIDATION_ERROR');
  }
  const options = [...input.options];
  const answer = JSON.parse(JSON.stringify(input.correctAnswer)) as JsonValue;
  return { _id: input.sourceId, organizationId: input.organizationId,
    schemaVersion: 1, version: 1, deletedAt: null,
    type: 'exercise', title: input.title, grade: input.grade,
    ...(input.textbook === undefined ? {} : { textbook: input.textbook }),
    ...(input.unit === undefined ? {} : { unit: input.unit }),
    ...(input.knowledgePoint === undefined ? {} : { knowledgePoint: input.knowledgePoint }),
    ...(input.difficulty === undefined ? {} : { difficulty: input.difficulty }),
    questionType: input.questionType, stem: input.stem, options, correctAnswer: answer,
    explanation: input.explanation, contentVersion: input.contentVersion,
    status: 'published', copyrightStatus: 'verified', publicCatalogSource: true,
    testOnly: false, teacherCatalogOnly: true,
    visibility: { type: 'organization' },
    payload: { questionIds: [input.sourceId], questionType: input.questionType,
      stem: input.stem, options, correctAnswer: answer, explanation: input.explanation,
      ...(input.exerciseSection === undefined ? {} : { exerciseSection: { ...input.exerciseSection } }),
      ...(input.acceptedAnswers === undefined ? {} : { acceptedAnswers: [...input.acceptedAnswers] }),
      ...(input.rubric === undefined ? {} : { rubric: input.rubric.map(row => ({ ...row })) }),
      assetLibrary: { kind: 'central_asset_library', resourceId: input.sourceId,
        version: input.contentVersion, manifestSha256: input.manifestSha256,
        sourceUrl: input.sourceUrl,
        ...(input.sourceKind === undefined ? {} : { sourceKind: input.sourceKind }),
        sourceSha256: input.sourceSha256, reviewId: input.reviewId,
        copyrightEvidenceId: input.copyrightEvidenceId,
        copyrightEvidenceSha256: input.copyrightEvidenceSha256,
        verifiedAt: input.verifiedAt,
        importedBy: input.importedBy, reviewStatus: 'source_verified_reusable',
        exercisePackId: input.exercisePackId,
        verificationScope: 'nonproduction_reusable', automatedVerifier: 'codex',
        testOnly: false, catalogScope: 'all_teachers' } },
  };
}

export function projectPublicQuestionForOrganization(source: VersionedDocument,
  organizationId: string): VersionedDocument {
  if (!isVerifiedPublicQuestionSource(source) || !validId(organizationId)) {
    throw new PublicQuestionDistributionError('VALIDATION_ERROR');
  }
  const id = publicQuestionProjectionId(source._id, organizationId);
  const payload = source.payload as Record<string, JsonValue>;
  const origin = payload.assetLibrary as Record<string, JsonValue>;
  return { ...source, _id: id, organizationId, version: 1, publicCatalogSource: false,
    publicQuestionProjection: true,
    payload: { ...payload, questionIds: [id],
      assetLibrary: { ...origin, resourceId: id, sourcePublicId: source._id } } };
}

/** Deterministic school projections keep existing organization-scoped readers unchanged. */
export class PublicQuestionDistributionService {
  public constructor(private readonly documents: DocumentDatabasePort,
    private readonly clock: Readonly<{ nowIso(): string }>) {}

  public async importVerified(input: VerifiedPublicQuestionInput,
    expectedOrganizationIds?: readonly string[]): Promise<Readonly<{
    sourceId: string; projectedOrganizations: readonly string[] }>> {
    const source = buildVerifiedPublicQuestionSource(input);
    const organizationIds = await this.activeOrganizations();
    if (expectedOrganizationIds && JSON.stringify([...expectedOrganizationIds].sort())
      !== JSON.stringify([...organizationIds].sort())) {
      throw new PublicQuestionDistributionError('CONFLICT');
    }
    await this.documents.runTransaction(async tx => {
      const existing = await tx.get('learning_resources', source._id);
      if (existing) {
        if (!sameSource(existing, source)) throw new PublicQuestionDistributionError('CONFLICT');
        return;
      }
      if (!await tx.create('learning_resources', source)) throw new PublicQuestionDistributionError('CONFLICT');
      if (!await tx.append('operation_logs', { _id: `public_question_import_${source._id}`,
        organizationId: source.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
        requestId: `public_question_import_${source._id}`, errorCode: null,
        action: 'asset_library.question.controlled_import', targetType: 'learning_resource',
        targetId: source._id, actorUserId: input.importedBy, actorRole: 'system',
        result: 'succeeded', occurredAt: this.clock.nowIso(),
        metadata: { sourceSha256: input.sourceSha256, manifestSha256: input.manifestSha256,
          copyrightEvidenceSha256: input.copyrightEvidenceSha256 } })) {
        throw new PublicQuestionDistributionError('CONFLICT');
      }
    });
    for (const organizationId of organizationIds) {
      if (organizationId !== source.organizationId) await this.ensureProjection(source._id, organizationId);
    }
    return { sourceId: source._id, projectedOrganizations: organizationIds };
  }

  /** Safe to retry for a newly created or reactivated school. */
  public async syncOrganization(organizationId: string): Promise<number> {
    const organization = await this.documents.get('organizations', organizationId);
    if (!organization || organization._id !== organizationId || organization.status !== 'active'
      || organization.deletedAt !== null) throw new PublicQuestionDistributionError('VALIDATION_ERROR');
    let offset = 0;
    let count = 0;
    while (offset <= 10000) {
      const page = await this.documents.findPage('learning_resources',
        { publicCatalogSource: true, type: 'exercise', status: 'published', deletedAt: null },
        { limit: 50, offset });
      for (const source of page.items) {
        if (source.organizationId !== organizationId && isVerifiedPublicQuestionSource(source)) {
          await this.ensureProjection(source._id, organizationId);
          count += 1;
        }
      }
      if (!page.hasMore) return count;
      offset += page.items.length;
    }
    throw new PublicQuestionDistributionError('SERVICE_UNAVAILABLE');
  }

  private async ensureProjection(sourceId: string, organizationId: string): Promise<void> {
    const id = publicQuestionProjectionId(sourceId, organizationId);
    await this.documents.runTransaction(async tx => {
      const source = await tx.get('learning_resources', sourceId);
      const next = source ? projectPublicQuestionForOrganization(source, organizationId) : null;
      if (!next) throw new PublicQuestionDistributionError('CONFLICT');
      const existing = await tx.get('learning_resources', id);
      if (existing) {
        if (!sameProjection(existing, next)) throw new PublicQuestionDistributionError('CONFLICT');
        return;
      }
      if (!await tx.create('learning_resources', next)) throw new PublicQuestionDistributionError('CONFLICT');
      if (!await tx.append('operation_logs', { _id: `public_question_projection_${id}`,
        organizationId, schemaVersion: 1, version: 1, deletedAt: null,
        requestId: `public_question_projection_${id}`, errorCode: null,
        action: 'asset_library.question.project_public', targetType: 'learning_resource',
        targetId: id, actorUserId: 'controlled_import', actorRole: 'system',
        result: 'succeeded', occurredAt: this.clock.nowIso(),
        metadata: { sourcePublicId: sourceId } })) throw new PublicQuestionDistributionError('CONFLICT');
    });
  }

  private async activeOrganizations(): Promise<readonly string[]> {
    const ids: string[] = [];
    let offset = 0;
    while (offset <= 10000) {
      const page = await this.documents.findPage('organizations',
        { status: 'active', deletedAt: null }, { limit: 50, offset });
      ids.push(...page.items.filter(row => row._id === row.organizationId).map(row => row._id));
      if (!page.hasMore) return ids;
      offset += page.items.length;
    }
    throw new PublicQuestionDistributionError('SERVICE_UNAVAILABLE');
  }
}

function sameSource(left: VersionedDocument, right: VersionedDocument): boolean {
  return left._id === right._id && left.organizationId === right.organizationId
    && left.publicCatalogSource === true && left.status === 'published'
    && JSON.stringify(left.payload) === JSON.stringify(right.payload);
}
function sameProjection(left: VersionedDocument, right: VersionedDocument): boolean {
  return left._id === right._id && left.organizationId === right.organizationId
    && left.publicQuestionProjection === true && left.status === 'published'
    && JSON.stringify(left.payload) === JSON.stringify(right.payload);
}
