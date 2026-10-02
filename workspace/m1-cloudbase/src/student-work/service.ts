import { hashHex } from '../shared/request-summary';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { RecordingSealPort, StudentWorkTransaction, StudentWorkUnitOfWork, WorkPlaybackPort } from './repository';
import { StudentWorkError, type StudentWork, type WorkMaterial, type WorkMaterialFacet,
  type WorkMaterialFilters, type WorkMaterialPage, type WorkMaterialView } from './types';
import { originalAudioExpired } from '../media-retention/policy';

export interface WorkClock { nowIso(): string }
export interface WorkIds { next(prefix: string): string }

const MAX_RECORDING_BYTES = 20 * 1024 * 1024;
const MAX_RECORDING_MS = 5 * 60 * 1000;

function validOperation(operationId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(operationId);
}

function visible(material: WorkMaterial, classId: string): boolean {
  return material.status === 'published' && material.demonstrationFileId.trim().length > 0
    && material.contentVersion.trim().length > 0
    && (material.visibility.type === 'organization' || material.visibility.classIds.includes(classId));
}

function materialView(material: WorkMaterial): WorkMaterialView {
  return { id: material.id, title: material.title, contentVersion: material.contentVersion,
    subtitle: material.subtitle,
    ...(material.grade ? { grade: material.grade } : {}),
    ...(material.textbook ? { textbook: material.textbook } : {}),
    ...(material.unit ? { unit: material.unit } : {}) };
}

function matchesFacet(value: string | undefined, filter: string | undefined, unlabeled: string): boolean {
  return filter === undefined || (filter === unlabeled ? !value : value === filter);
}

export class StudentWorkService {
  public constructor(private readonly repository: StudentWorkUnitOfWork,
    private readonly storage: RecordingSealPort | null, private readonly clock: WorkClock,
    private readonly ids: WorkIds, private readonly playback: WorkPlaybackPort | null = null) {}

  public async listMaterials(actor: TrustedActorContext): Promise<readonly WorkMaterialView[]> {
    this.studentOnly(actor);
    return this.repository.transaction(async transaction => {
      const classId = await this.classId(transaction, actor);
      return (await transaction.listMaterials(actor.organizationId))
        .filter(material => visible(material, classId))
        .map(materialView);
    });
  }

  public async searchMaterials(actor: TrustedActorContext, keyword: string, offset: number,
    limit: number, filters: WorkMaterialFilters = {}): Promise<WorkMaterialPage> {
    this.studentOnly(actor);
    if (typeof keyword !== 'string' || keyword.length > 80 || !Number.isSafeInteger(offset)
      || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50
      || Object.values(filters).some(value => value !== undefined
        && (typeof value !== 'string' || value.length > 80))) {
      throw new StudentWorkError('VALIDATION_ERROR');
    }
    const query = keyword.trim().toLocaleLowerCase();
    return this.repository.transaction(async transaction => {
      const classId = await this.classId(transaction, actor);
      const matching = (await transaction.listMaterials(actor.organizationId))
        .filter(material => visible(material, classId)
          && (!query || material.title.toLocaleLowerCase().includes(query)
            || material.subtitle.toLocaleLowerCase().includes(query))
          && matchesFacet(material.grade, filters.grade, '__unlabeled_grade__')
          && matchesFacet(material.textbook, filters.textbook, '__unlabeled_textbook__')
          && matchesFacet(material.unit, filters.unit, '__unlabeled_unit__'))
        .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN') || left.id.localeCompare(right.id));
      return { items: matching.slice(offset, offset + limit).map(materialView), total: matching.length,
        nextOffset: offset + limit < matching.length ? offset + limit : null };
    });
  }

  public async listMaterialFacets(actor: TrustedActorContext): Promise<readonly WorkMaterialFacet[]> {
    this.studentOnly(actor);
    return this.repository.transaction(async transaction => {
      const classId = await this.classId(transaction, actor);
      const facets = (await transaction.listMaterials(actor.organizationId))
        .filter(material => visible(material, classId))
        .map(material => ({ ...(material.grade ? { grade: material.grade } : {}),
          ...(material.textbook ? { textbook: material.textbook } : {}),
          ...(material.unit ? { unit: material.unit } : {}) }));
      return [...new Map(facets.map(facet => [JSON.stringify(facet), facet])).values()];
    });
  }

  public async getMaterial(actor: TrustedActorContext, materialId: string): Promise<WorkMaterialView> {
    this.studentOnly(actor);
    if (!materialId?.trim()) throw new StudentWorkError('VALIDATION_ERROR');
    return this.repository.transaction(async transaction => {
      const classId = await this.classId(transaction, actor);
      const material = await transaction.findMaterial(actor.organizationId, materialId);
      if (!material || !visible(material, classId)) throw new StudentWorkError('NOT_FOUND');
      return materialView(material);
    });
  }

  public async beginDraft(actor: TrustedActorContext, materialId: string, operationId: string): Promise<StudentWork> {
    this.studentOnly(actor);
    if (!materialId?.trim() || !validOperation(operationId)) throw new StudentWorkError('VALIDATION_ERROR');
    const fingerprint = JSON.stringify({ action: 'beginDraft', materialId });
    return this.repository.transaction(async transaction => {
      const classId = await this.classId(transaction, actor);
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new StudentWorkError('CONFLICT');
        return prior.result;
      }
      const material = await transaction.findMaterial(actor.organizationId, materialId);
      if (!material || !visible(material, classId)) throw new StudentWorkError('RESOURCE_OFFLINE');
      const id = this.ids.next('student_work');
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new StudentWorkError('SERVICE_UNAVAILABLE');
      const ownerDigest = hashHex(JSON.stringify([actor.organizationId, actor.actorUserId]));
      const work: StudentWork = { id, organizationId: actor.organizationId,
        studentId: actor.actorUserId, classId, materialId, materialVersion: material.contentVersion,
        stagingPath: `student-works/staging/${ownerDigest}/${id}.mp3`,
        status: 'draft', fileId: null, contentSha256: null, sizeBytes: null, durationMs: null,
        note: '', version: 1, createdAt: this.clock.nowIso(), submittedAt: null };
      if (!await transaction.saveWork(work, 0)
        || !await transaction.saveReceipt({ organizationId: actor.organizationId, studentId: actor.actorUserId,
          operationId, fingerprint, result: work })) throw new StudentWorkError('CONFLICT');
      return work;
    });
  }

  public async submit(actor: TrustedActorContext, input: Readonly<{ workId: string; stagingFileId: string;
    note: string }>, expectedVersion: number, operationId: string): Promise<StudentWork> {
    this.studentOnly(actor);
    if (!validOperation(operationId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1
      || !input.workId?.trim() || !input.stagingFileId?.trim() || typeof input.note !== 'string'
      || input.note.length > 200) throw new StudentWorkError('VALIDATION_ERROR');
    const note = input.note.trim();
    const fingerprint = JSON.stringify({ action: 'submit', workId: input.workId,
      stagingFileId: input.stagingFileId, note, expectedVersion });
    const prepared = await this.repository.transaction(async transaction => {
      const classId = await this.classId(transaction, actor);
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new StudentWorkError('CONFLICT');
        return { completed: prior.result } as const;
      }
      const work = await transaction.findWork(actor.organizationId, input.workId);
      if (!work || work.studentId !== actor.actorUserId || work.classId !== classId) throw new StudentWorkError('NOT_FOUND');
      if (work.status !== 'draft' || work.version !== expectedVersion) throw new StudentWorkError('CONFLICT');
      const material = await transaction.findMaterial(actor.organizationId, work.materialId);
      if (!material || !visible(material, classId) || material.contentVersion !== work.materialVersion) {
        throw new StudentWorkError('RESOURCE_OFFLINE');
      }
      return { work } as const;
    });
    if ('completed' in prepared && prepared.completed) return prepared.completed;
    if (!this.storage) throw new StudentWorkError('SERVICE_UNAVAILABLE');
    const sealed = await this.storage.inspectAndSeal({ stagingFileId: input.stagingFileId,
      stagingPath: prepared.work.stagingPath, organizationId: actor.organizationId,
      studentId: actor.actorUserId, workId: input.workId });
    if (!sealed.fileId.trim() || !/^[a-f0-9]{64}$/.test(sealed.contentSha256)
      || !Number.isSafeInteger(sealed.sizeBytes) || sealed.sizeBytes < 1 || sealed.sizeBytes > MAX_RECORDING_BYTES
      || !Number.isSafeInteger(sealed.durationMs) || sealed.durationMs < 1000 || sealed.durationMs > MAX_RECORDING_MS
      || (sealed.codec !== 'mp3' && sealed.codec !== 'aac')) throw new StudentWorkError('MEDIA_INVALID');
    return this.repository.transaction(async transaction => {
      const classId = await this.classId(transaction, actor);
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new StudentWorkError('CONFLICT');
        return prior.result;
      }
      const current = await transaction.findWork(actor.organizationId, input.workId);
      if (!current || current.studentId !== actor.actorUserId || current.classId !== classId
        || current.status !== 'draft' || current.version !== expectedVersion
        || current.stagingPath !== prepared.work.stagingPath) throw new StudentWorkError('CONFLICT');
      const material = await transaction.findMaterial(actor.organizationId, current.materialId);
      if (!material || !visible(material, classId) || material.contentVersion !== current.materialVersion) {
        throw new StudentWorkError('RESOURCE_OFFLINE');
      }
      const result: StudentWork = { ...current, status: 'submitted', fileId: sealed.fileId,
        contentSha256: sealed.contentSha256, sizeBytes: sealed.sizeBytes, durationMs: sealed.durationMs,
        note, version: expectedVersion + 1, submittedAt: this.clock.nowIso() };
      if (!await transaction.saveWork(result, expectedVersion)
        || !await transaction.saveReceipt({ organizationId: actor.organizationId, studentId: actor.actorUserId,
          operationId, fingerprint, result })) throw new StudentWorkError('CONFLICT');
      return result;
    });
  }

  public async deleteDraft(actor: TrustedActorContext, workId: string, expectedVersion: number,
    operationId: string): Promise<StudentWork> {
    this.studentOnly(actor);
    if (!workId?.trim() || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1
      || !validOperation(operationId)) throw new StudentWorkError('VALIDATION_ERROR');
    const fingerprint = JSON.stringify({ action: 'deleteDraft', workId, expectedVersion });
    return this.repository.transaction(async transaction => {
      const classId = await this.classId(transaction, actor);
      const prior = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new StudentWorkError('CONFLICT');
        return prior.result;
      }
      const work = await transaction.findWork(actor.organizationId, workId);
      if (!work || work.studentId !== actor.actorUserId || work.classId !== classId) {
        throw new StudentWorkError('NOT_FOUND');
      }
      if (work.status !== 'draft' || work.version !== expectedVersion) throw new StudentWorkError('CONFLICT');
      const deletedAt = this.clock.nowIso();
      const result: StudentWork = { ...work, version: expectedVersion + 1, deletedAt,
        recoverableUntil: new Date(Date.parse(deletedAt) + 7 * 24 * 60 * 60 * 1000).toISOString(),
        deletedByUserId: actor.actorUserId, recoveryState: 'deleted' };
      if (!await transaction.saveWork(result, expectedVersion)
        || !await transaction.saveReceipt({ organizationId: actor.organizationId,
          studentId: actor.actorUserId, operationId, fingerprint, result,
          action: 'deleteDraft', occurredAt: deletedAt })) throw new StudentWorkError('CONFLICT');
      return result;
    });
  }

  public async listMine(actor: TrustedActorContext): Promise<readonly StudentWork[]> {
    this.studentOnly(actor);
    return this.repository.transaction(async transaction => {
      await this.classId(transaction, actor);
      return (await transaction.listStudentWorks(actor.organizationId, actor.actorUserId))
        .map(work => ({ ...work, mediaExpired: Boolean(work.mediaDeletedAt)
          || originalAudioExpired(work.submittedAt, this.clock.nowIso()) }));
    });
  }

  public async getPlayback(actor: TrustedActorContext, workId: string): Promise<Readonly<{
    workId: string; temporaryUrl: string; expiresAt: string }>> {
    this.studentOnly(actor);
    if (!workId?.trim()) throw new StudentWorkError('VALIDATION_ERROR');
    const fileId = await this.repository.transaction(async transaction => {
      const classId = await this.classId(transaction, actor);
      const work = await transaction.findWork(actor.organizationId, workId);
      if (!work || work.studentId !== actor.actorUserId || work.classId !== classId
        || work.status !== 'submitted' || !work.fileId || !work.contentSha256
        || work.mediaDeletedAt || originalAudioExpired(work.submittedAt, this.clock.nowIso())) {
        throw new StudentWorkError('NOT_FOUND');
      }
      return work.fileId;
    });
    if (!this.playback) throw new StudentWorkError('SERVICE_UNAVAILABLE');
    const temporaryUrl = await this.playback.temporaryUrl(fileId);
    if (!/^https:\/\//.test(temporaryUrl)) throw new StudentWorkError('SERVICE_UNAVAILABLE');
    return { workId, temporaryUrl, expiresAt: new Date(Date.parse(this.clock.nowIso()) + 60_000).toISOString() };
  }

  public async getMaterialPlayback(actor: TrustedActorContext, materialId: string): Promise<Readonly<{
    materialId: string; temporaryUrl: string; expiresAt: string }>> {
    this.studentOnly(actor);
    if (!materialId?.trim()) throw new StudentWorkError('VALIDATION_ERROR');
    const fileId = await this.repository.transaction(async transaction => {
      const classId = await this.classId(transaction, actor);
      const material = await transaction.findMaterial(actor.organizationId, materialId);
      if (!material || !visible(material, classId)) throw new StudentWorkError('NOT_FOUND');
      return material.demonstrationFileId;
    });
    if (!this.playback) throw new StudentWorkError('SERVICE_UNAVAILABLE');
    const temporaryUrl = await this.playback.temporaryUrl(fileId);
    if (!/^https:\/\//.test(temporaryUrl)) throw new StudentWorkError('SERVICE_UNAVAILABLE');
    return { materialId, temporaryUrl, expiresAt: new Date(Date.parse(this.clock.nowIso()) + 60_000).toISOString() };
  }

  private studentOnly(actor: TrustedActorContext): void {
    if (actor.actorRole !== 'student') throw new StudentWorkError('FORBIDDEN');
  }

  private async classId(transaction: StudentWorkTransaction, actor: TrustedActorContext): Promise<string> {
    const classId = await transaction.findActiveClassId(actor.organizationId, actor.actorUserId);
    if (!classId) throw new StudentWorkError('FORBIDDEN');
    return classId;
  }
}
