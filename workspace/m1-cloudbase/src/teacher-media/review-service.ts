import type { TrustedActorContext } from '../auth/trusted-actor';
import { authorizeNativeAdmin, type NativeAdminGrantReader } from '../native-admin/authorization';
import { freezeTeacherMediaForTask, type TeacherMediaCandidate, type TeacherMediaGateResult } from './publish-gate';

export interface TeacherMediaRecord extends TeacherMediaCandidate {
  readonly ownerTeacherId: string;
  readonly stagingPath?: string;
  readonly recordVersion: number;
  readonly rejectionReason: string | null;
}

export interface TeacherMediaOperationReceipt {
  readonly fingerprint: string;
  readonly result: TeacherMediaRecord;
}

export interface TeacherMediaTransaction {
  find(organizationId: string, mediaId: string): Promise<TeacherMediaRecord | null>;
  save(record: TeacherMediaRecord, expectedRecordVersion: number): Promise<boolean>;
  findReceipt(organizationId: string, actorId: string, operationId: string): Promise<TeacherMediaOperationReceipt | null>;
  saveReceipt(organizationId: string, actorId: string, operationId: string,
    receipt: TeacherMediaOperationReceipt): Promise<boolean>;
  hasCurrentTeacherClassGrant(organizationId: string, teacherId: string, classId: string,
    permission: string): Promise<boolean>;
  appendAudit(entry: Readonly<{ organizationId: string; actorId: string; mediaId: string; action: string;
    result: 'succeeded' | 'denied'; reasonProvided: boolean; occurredAt: string }>): Promise<void>;
}

export interface TeacherMediaUnitOfWork {
  transaction<T>(work: (transaction: TeacherMediaTransaction) => Promise<T>): Promise<T>;
}

export class TeacherMediaError extends Error {
  public constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR') {
    super(code);
  }
}

/** Local T-19/T-20/A-08 lifecycle; upload sealing and CloudBase adapter remain separate. */
export class TeacherMediaReviewService {
  public constructor(private readonly repository: TeacherMediaUnitOfWork,
    private readonly nativeAdmin: NativeAdminGrantReader,
    private readonly clock: Readonly<{ nowIso(): string }>) {}

  public submitForReview(actor: TrustedActorContext, mediaId: string, expectedRecordVersion: number,
    operationId: string): Promise<TeacherMediaRecord> {
    return this.transition(actor, mediaId, expectedRecordVersion, operationId, 'submit', '', async (tx, media) => {
      if (actor.actorRole !== 'teacher' || media.ownerTeacherId !== actor.actorUserId
        || !actor.permissions.includes('media.upload')) throw new TeacherMediaError('FORBIDDEN');
      for (const classId of media.allowedClassIds) {
        if (!actor.scopeIds.includes(classId) || !await tx.hasCurrentTeacherClassGrant(
          actor.organizationId, actor.actorUserId, classId, 'media.upload')) throw new TeacherMediaError('FORBIDDEN');
      }
      if (media.status !== 'draft' && media.status !== 'rejected') throw new TeacherMediaError('CONFLICT');
      const probe = this.publishProbe(media);
      if (probe.ready === false && probe.reason !== 'UNREVIEWED') throw new TeacherMediaError('VALIDATION_ERROR');
      return { ...media, status: 'pending_review', rejectionReason: null, recordVersion: media.recordVersion + 1 };
    });
  }

  public review(actor: TrustedActorContext, mediaId: string, expectedRecordVersion: number,
    operationId: string, decision: 'approved' | 'rejected', reason: string): Promise<TeacherMediaRecord> {
    if (decision === 'rejected' && (reason.trim().length < 1 || reason.length > 300)) {
      return Promise.reject(new TeacherMediaError('VALIDATION_ERROR'));
    }
    return this.transition(actor, mediaId, expectedRecordVersion, operationId, decision, reason, async (_tx, media) => {
      await this.assertReviewer(actor, media);
      if (media.status !== 'pending_review') throw new TeacherMediaError('CONFLICT');
      if (decision === 'rejected') return { ...media, status: 'rejected', rejectionReason: reason.trim(),
        reviewedAt: this.clock.nowIso(), reviewedBy: actor.actorUserId,
        reviewVersion: null, recordVersion: media.recordVersion + 1 };
      const approved: TeacherMediaRecord = { ...media, status: 'approved', reviewVersion: media.version,
        copyrightStatus: 'verified',
        reviewedAt: this.clock.nowIso(), reviewedBy: actor.actorUserId,
        rejectionReason: null, recordVersion: media.recordVersion + 1 };
      if (!this.publishProbe(approved).ready) throw new TeacherMediaError('VALIDATION_ERROR');
      return approved;
    });
  }

  public publish(actor: TrustedActorContext, mediaId: string, expectedRecordVersion: number,
    operationId: string): Promise<TeacherMediaRecord> {
    return this.transition(actor, mediaId, expectedRecordVersion, operationId, 'publish', '', async (_tx, media) => {
      await this.assertReviewer(actor, media);
      if (media.status !== 'approved') throw new TeacherMediaError('CONFLICT');
      const published: TeacherMediaRecord = { ...media, status: 'published', recordVersion: media.recordVersion + 1 };
      if (!freezeTeacherMediaForTask(published, actor.organizationId, published.allowedClassIds).ready) {
        throw new TeacherMediaError('VALIDATION_ERROR');
      }
      return published;
    });
  }

  private publishProbe(media: TeacherMediaRecord): TeacherMediaGateResult {
    return freezeTeacherMediaForTask({ ...media, status: 'published',
      reviewVersion: media.version, reviewedAt: media.reviewedAt ?? this.clock.nowIso(),
      reviewedBy: media.reviewedBy ?? 'pending_review' }, media.organizationId, media.allowedClassIds);
  }

  private async assertReviewer(actor: TrustedActorContext, media: TeacherMediaRecord): Promise<void> {
    if (actor.actorUserId === media.ownerTeacherId) throw new TeacherMediaError('FORBIDDEN');
    for (const classId of media.allowedClassIds) {
      const decision = await authorizeNativeAdmin(this.nativeAdmin, actor, 'media.review', classId);
      if (!decision.allowed) throw new TeacherMediaError('FORBIDDEN');
    }
  }

  private async transition(actor: TrustedActorContext, mediaId: string, expectedRecordVersion: number,
    operationId: string, action: string, reason: string,
    work: (tx: TeacherMediaTransaction, media: TeacherMediaRecord) => Promise<TeacherMediaRecord>): Promise<TeacherMediaRecord> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(mediaId) || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId)
      || !Number.isSafeInteger(expectedRecordVersion) || expectedRecordVersion < 1) {
      throw new TeacherMediaError('VALIDATION_ERROR');
    }
    const fingerprint = JSON.stringify({ mediaId, expectedRecordVersion, action, reason });
    try {
      return await this.repository.transaction(async tx => {
      const media = await tx.find(actor.organizationId, mediaId);
      if (!media) throw new TeacherMediaError('NOT_FOUND');
      const prior = await tx.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new TeacherMediaError('CONFLICT');
        // Authorization is checked anew even on replay.
        if (action === 'submit') {
          if (actor.actorRole !== 'teacher' || media.ownerTeacherId !== actor.actorUserId
            || !actor.permissions.includes('media.upload')) throw new TeacherMediaError('FORBIDDEN');
          for (const classId of media.allowedClassIds) {
            if (!actor.scopeIds.includes(classId) || !await tx.hasCurrentTeacherClassGrant(
              actor.organizationId, actor.actorUserId, classId, 'media.upload')) throw new TeacherMediaError('FORBIDDEN');
          }
        } else await this.assertReviewer(actor, media);
        return prior.result;
      }
      if (media.recordVersion !== expectedRecordVersion) throw new TeacherMediaError('CONFLICT');
      const next = await work(tx, media);
      if (!await tx.save(next, expectedRecordVersion)) throw new TeacherMediaError('CONFLICT');
      if (!await tx.saveReceipt(actor.organizationId, actor.actorUserId, operationId, { fingerprint, result: next })) {
        throw new TeacherMediaError('CONFLICT');
      }
      await tx.appendAudit({ organizationId: actor.organizationId, actorId: actor.actorUserId,
        mediaId, action, result: 'succeeded', reasonProvided: reason.trim().length > 0,
        occurredAt: this.clock.nowIso() });
      return next;
      });
    } catch (error: unknown) {
      if (error instanceof TeacherMediaError) {
        await this.repository.transaction(tx => tx.appendAudit({ organizationId: actor.organizationId,
          actorId: actor.actorUserId, mediaId, action, result: 'denied',
          reasonProvided: reason.trim().length > 0, occurredAt: this.clock.nowIso() }));
      }
      throw error;
    }
  }
}
