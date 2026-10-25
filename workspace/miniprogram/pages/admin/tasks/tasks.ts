import { createNativeAdminPage } from '../../../subpackages/admin/admin-page'

createNativeAdminPage({
  id: 'A-07', title: '任务与活动管理', subtitle: '历史快照保留', permission: 'task.manage',
  dataKind: 'records', recordKind: 'tasks',
  filterPlaceholder: '搜索任务或活动', modules: [
    { id: 'classroom', title: '课堂任务', description: '类型、班级、当前状态与待检查' },
    { id: 'activities', title: '打卡活动', description: '完成记录、关闭与榜单' },
    { id: 'audit', title: '导出与审计', description: '停用后仍保留提交和点评历史' },
  ],
})
