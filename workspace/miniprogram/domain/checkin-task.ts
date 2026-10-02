import type { ActivityDayView, ActivityView, TaskDetailView } from './types'

export interface CheckinConditionRow {
  key: string
  index: number
  kind: string
  resourceId: string
  label: string
  detail: string
  statusLabel: string
  iconName: string
  iconTone: string
  complete: boolean
  canOpen: boolean
  taskId: string
  exerciseActionable: boolean
}

export function checkinConditionRows(activity: ActivityView, day: ActivityDayView | null,
  tasks: readonly TaskDetailView[], canWorkToday: boolean): CheckinConditionRow[] {
  return activity.schedule.conditions.map((condition, index) => {
    const kind: string = condition.kind
    const supported = kind === 'reading' || kind === 'vocabulary' || kind === 'exercise' || kind === 'work'
    const evidence = day?.conditionProgress?.find(item => item.index === index
      && item.kind === condition.kind && item.resourceId === condition.resourceId)
    const complete = Boolean(day?.supplemented || evidence?.complete || day?.complete && !day.conditionProgress)
    const matchingTasks = condition.kind === 'exercise' ? tasks.filter(item =>
      item.assignment.classId === activity.schedule.classId
      && item.task.status !== 'withdrawn' && item.task.status !== 'draft'
      && item.task.items.some(taskItem => taskItem.type === 'exercise'
        && taskItem.resourceId === condition.resourceId)) : []
    const matchingTask = matchingTasks.find(item => item.assignment.status !== 'completed'
      && item.assignment.status !== 'awaiting_review') ?? matchingTasks[0]
    const taskId = matchingTask?.task.id ?? ''
    const exerciseActionable = Boolean(matchingTask && matchingTask.assignment.status !== 'completed'
      && matchingTask.assignment.status !== 'awaiting_review')
    const label = kind === 'reading' ? '阅读' : kind === 'vocabulary' ? '单词练习'
      : kind === 'exercise' ? '习题任务' : kind === 'work' ? '提交作品'
        : kind === 'listening' ? '听力任务' : kind === 'audio' ? '音频任务' : '后续内容'
    const detail = condition.kind === 'vocabulary' ? `今天完成至少 ${condition.requiredWordCount} 个单词`
      : condition.kind === 'exercise' ? `今天提交对应习题，成绩达到 ${condition.minimumScore} 分`
        : condition.kind === 'reading' ? '今天读完活动指定的全部页面'
          : kind === 'work' ? '今天使用指定素材提交作品' : '该类型尚未开放'
    const statusLabel = !supported ? '后续开放' : !canWorkToday ? '非打卡日' : day?.supplemented ? '教师已补记'
      : evidence ? evidence.complete ? '已完成' : '待完成'
        : day?.complete ? '已计入今日完成' : '待核对'
    const iconName = kind === 'reading' ? 'reading' : kind === 'vocabulary' ? 'vocabulary'
      : kind === 'exercise' ? 'exercise' : kind === 'work' ? 'dubbing' : 'headphones'
    const iconTone = kind === 'vocabulary' ? 'warning' : kind === 'work' ? 'ai' : 'primary'
    return { key: `${condition.kind}:${condition.resourceId}:${index}`, index, kind: condition.kind,
      resourceId: condition.resourceId, label, detail, statusLabel, iconName, iconTone, complete,
      canOpen: supported && canWorkToday && (kind !== 'exercise' || Boolean(taskId)), taskId, exerciseActionable }
  })
}
