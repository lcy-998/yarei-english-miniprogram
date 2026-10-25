import type { TrustedActorContext } from '../auth/trusted-actor';
import type { DocumentDatabasePort } from '../repositories/document-database-port';
import { hashHex } from '../shared/request-summary';
import type { TaskRecordingRecord } from '../task-recording/types';
import { ParentMediaError, type ParentPlaybackAuditPort } from './parent-media-playback';
import { ParentFeedbackVoiceError, type ParentFeedbackVoiceAudit } from './parent-feedback-voice';
import { ParentTaskMediaError, type ParentTaskMediaAudit } from './parent-task-media-playback';

export class DocumentParentPlaybackAudit implements ParentPlaybackAuditPort {
  public constructor(private readonly documents: DocumentDatabasePort) {}

  public async record(actor: TrustedActorContext, recording: TaskRecordingRecord, at: string): Promise<void> {
    const id = `audit:${actor.organizationId}:${actor.requestId}`;
    const inserted = await this.documents.runTransaction(transaction => transaction.append('operation_logs', {
      _id: id, organizationId: actor.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
      id: `parent_recording_playback_${hashHex(JSON.stringify([actor.organizationId, actor.requestId]))}`,
      requestId: actor.requestId, actorUserId: actor.actorUserId, actorRole: actor.actorRole,
      action: 'parent-query.getRecordingPlayback', targetType: 'task_recording', targetId: recording.id,
      result: 'succeeded', errorCode: null, occurredAt: at,
      metadata: { studentId: recording.studentId, taskId: recording.taskId,
        itemId: recording.itemId, submissionVersion: recording.submissionVersion },
    }));
    if (!inserted) throw new ParentMediaError('SERVICE_UNAVAILABLE');
  }
}

export class DocumentParentFeedbackVoiceAudit implements ParentFeedbackVoiceAudit {
  public constructor(private readonly documents: DocumentDatabasePort) {}

  public async record(actor: TrustedActorContext, feedbackId: string,
    submissionVersion: number, at: string): Promise<void> {
    const id = `audit:${actor.organizationId}:${actor.requestId}`;
    const inserted = await this.documents.runTransaction(transaction => transaction.append('operation_logs', {
      _id: id, organizationId: actor.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
      id: `parent_feedback_voice_${hashHex(JSON.stringify([actor.organizationId, actor.requestId]))}`,
      requestId: actor.requestId, actorUserId: actor.actorUserId, actorRole: actor.actorRole,
      action: 'parent-query.getChildFeedbackVoicePlayback', targetType: 'review_feedback',
      targetId: feedbackId, result: 'succeeded', errorCode: null, occurredAt: at,
      metadata: { submissionVersion },
    }));
    if (!inserted) throw new ParentFeedbackVoiceError('SERVICE_UNAVAILABLE');
  }
}

export class DocumentParentTaskMediaAudit implements ParentTaskMediaAudit {
  public constructor(private readonly documents: DocumentDatabasePort) {}

  public async record(actor: TrustedActorContext, taskId: string, itemId: string,
    submissionVersion: number, mediaId: string, at: string): Promise<void> {
    const id = `audit:${actor.organizationId}:${actor.requestId}`;
    const inserted = await this.documents.runTransaction(transaction => transaction.append('operation_logs', {
      _id: id, organizationId: actor.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
      id: `parent_task_media_${hashHex(JSON.stringify([actor.organizationId, actor.requestId]))}`,
      requestId: actor.requestId, actorUserId: actor.actorUserId, actorRole: actor.actorRole,
      action: 'parent-query.getTaskMediaPlayback', targetType: 'task_media', targetId: mediaId,
      result: 'succeeded', errorCode: null, occurredAt: at,
      metadata: { taskId, itemId, submissionVersion },
    }));
    if (!inserted) throw new ParentTaskMediaError('SERVICE_UNAVAILABLE');
  }
}
