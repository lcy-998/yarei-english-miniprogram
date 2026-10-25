import { createNativeAdminPage } from '../admin-page'

createNativeAdminPage({
  id: 'A-06', title: '学校习题库管理', subtitle: '题目只读预览与上下架', permission: 'question.manage',
  dataKind: 'records', recordKind: 'questions',
  filterPlaceholder: '搜索题目或知识点', modules: [],
})
