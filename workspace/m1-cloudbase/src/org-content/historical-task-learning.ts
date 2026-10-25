import type { DocumentDatabaseReaderPort, VersionedDocument } from '../repositories/document-database-port';
import type { JsonObject } from '../shared/protocol';

export interface HistoricalTaskLearningItem {
  readonly taskId: string;
  readonly itemId: string;
  readonly resourceId: string;
  readonly type: 'reading' | 'vocabulary';
  readonly title: string;
  readonly contentVersion: string;
  readonly payload: JsonObject;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function visible(row: VersionedDocument | null, organizationId: string): row is VersionedDocument {
  return row !== null && row.organizationId === organizationId && row.deletedAt === null;
}
function validTask(task: VersionedDocument, assignment: VersionedDocument): boolean {
  return (task.visibility === 'visible'
      || task.visibility === 'recycled' && typeof assignment.latestSubmissionId === 'string')
    && task.status !== 'draft' && task.status !== 'withdrawn'
    && typeof task.publishedAt === 'string' && Number.isFinite(Date.parse(task.publishedAt));
}

/** Source, version and media keys come only from the student's frozen published task item. */
export async function findHistoricalTaskLearningItem(reader: DocumentDatabaseReaderPort,
  organizationId: string, studentId: string,
  selector: Readonly<{ taskId?: string; itemId?: string; resourceId?: string }>):
  Promise<HistoricalTaskLearningItem | null> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(studentId)
    || [selector.taskId, selector.itemId, selector.resourceId]
      .some(id => id !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(id))
    || selector.taskId && !selector.itemId) return null;
  const assignments = await reader.find('task_assignments', {
    organizationId, studentId, deletedAt: null,
  });
  if (assignments.length > 1000) return null;
  for (const assignment of assignments) {
    if (!visible(assignment, organizationId) || typeof assignment.taskId !== 'string'
      || selector.taskId && assignment.taskId !== selector.taskId) continue;
    const task = await reader.get('tasks', assignment.taskId);
    if (!visible(task, organizationId) || !validTask(task, assignment)
      || !Array.isArray(task.items)) continue;
    for (const rawItem of task.items) {
      const item = object(rawItem);
      const snapshot = object(item?.resourceSnapshot);
      const payload = object(snapshot?.payload);
      const rawVersion = item?.resourceVersion;
      if (!item || !snapshot || !payload
        || selector.itemId && item.id !== selector.itemId
        || selector.resourceId && item.resourceId !== selector.resourceId
        || typeof item.id !== 'string' || typeof item.resourceId !== 'string'
        || (snapshot.type !== 'reading' && snapshot.type !== 'vocabulary')
        || typeof snapshot.title !== 'string'
        || !(typeof rawVersion === 'string' && rawVersion.trim()
          || typeof rawVersion === 'number' && Number.isFinite(rawVersion))) continue;
      return { taskId: task._id, itemId: item.id, resourceId: item.resourceId,
        type: snapshot.type, title: snapshot.title,
        contentVersion: String(rawVersion), payload: payload as JsonObject };
    }
  }
  return null;
}
