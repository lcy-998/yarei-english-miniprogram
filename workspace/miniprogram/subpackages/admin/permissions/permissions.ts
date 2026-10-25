import { createNativeAdminPage } from '../admin-page'

createNativeAdminPage({
  id: 'A-04', title: '权限管理', subtitle: '逐账号独立授权', permission: 'authorization.manage',
  filterPlaceholder: '搜索教师账号', modules: [],
})
