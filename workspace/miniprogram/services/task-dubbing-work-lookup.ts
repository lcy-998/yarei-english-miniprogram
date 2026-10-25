import type { ServiceResult, TaskDubbingWorkView } from '../domain/types'
import { listMyTaskDubbingWorks } from './task-media-service'

/** Restore a sealed work from the student's authorized cloud list after local session drafts are cleared. */
export async function findSubmittedTaskDubbingWork(userId: string, taskId: string,
  itemId: string, round: number): Promise<ServiceResult<TaskDubbingWorkView | null>> {
  let offset = 0
  let latest: TaskDubbingWorkView | null = null
  while (offset <= 10000) {
    const page = await listMyTaskDubbingWorks(userId, offset, 50)
    if (!page.ok) return page
    for (const work of page.data.items) {
      if (work.taskId !== taskId || work.itemId !== itemId || work.round !== round) continue
      if (latest?.submittedAt && Date.parse(latest.submittedAt) >= Date.parse(work.submittedAt)) continue
      latest = { workId: work.workId, taskId, itemId, round, stagingPath: '',
        status: 'submitted', durationMs: work.durationMs,
        submittedAt: work.submittedAt, version: 2 }
    }
    if (page.data.nextOffset === null) return { ok: true, data: latest }
    if (page.data.nextOffset <= offset) break
    offset = page.data.nextOffset
  }
  return { ok: false, error: { code: 'SERVICE_UNAVAILABLE',
    message: '配音记录过多，暂时无法核对本轮作品', retryable: true } }
}
