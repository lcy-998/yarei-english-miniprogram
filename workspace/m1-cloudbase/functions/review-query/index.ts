import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { REVIEW_QUERY_ACTIONS, validateReviewQueryRequest } from '../../src/contracts/task-query-functions';
import { createDefaultCloudBaseTaskQueryFunction } from '../shared/default-cloudbase-function';
import { createReviewQueryFunction } from './function-entry';
import { DocumentTaskDubbingWorkPort } from '../../src/task-media/document-work-port';
import { randomUUID } from 'node:crypto';

export { createReviewQueryFunction } from './function-entry';

const unavailable = createUnconfiguredFunction(
  'review-query',
  REVIEW_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateReviewQueryRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  },
);

export const main = createDefaultCloudBaseTaskQueryFunction(
  'review-query',
  unavailable,
  (capabilities, infrastructure) => createReviewQueryFunction({
    ...infrastructure,
    handler: infrastructure.reviewHandler,
    ...(capabilities.playbackStorage === undefined ? {} : { readingMediaStorage: capabilities.playbackStorage }),
    ...(capabilities.playbackStorage === undefined ? {} : { taskMediaReviewAccess: {
      async temporaryUrl(fileId: string): Promise<string> {
        const signed = await capabilities.playbackStorage!.getTempFileURL({
          fileList: [{ fileID: fileId, maxAge: 60 }],
        });
        const item = signed.fileList?.find(entry => entry.fileID === fileId);
        if (!item?.tempFileURL?.startsWith('https://')
          || (item.code !== undefined && item.code !== 'SUCCESS')) throw new Error('MEDIA_SIGN_FAILED');
        return item.tempFileURL;
      },
      findTaskDubbingWork: (workId: string) =>
        new DocumentTaskDubbingWorkPort(infrastructure.documents).findTaskDubbingWork(workId),
      async appendAudit(actor: { organizationId: string; actorUserId: string; actorRole: string },
        submissionId: string, itemId: string): Promise<boolean> {
        const id = `task_media_teacher_audit_${randomUUID()}`;
        try {
          return await infrastructure.documents.runTransaction(tx => tx.append('operation_logs', {
            _id: id, organizationId: actor.organizationId, schemaVersion: 1, version: 1,
            deletedAt: null, requestId: id, actorUserId: actor.actorUserId,
            actorRole: actor.actorRole, action: 'task_media.teacher_review_evidence',
            targetType: 'submission', targetId: submissionId, result: 'succeeded',
            errorCode: null, occurredAt: infrastructure.clock.nowIso(),
            metadata: { itemId },
          }));
        } catch { return false; }
      },
    } }),
  }),
);
