import { createNativeAdminPage } from '../admin-page'

createNativeAdminPage({
  id: 'A-03', title: '用户管理', subtitle: '账号与绑定关系', permission: 'user.manage',
  dataKind: 'users',
  filterPlaceholder: '搜索姓名、学号或账号', modules: [],
})
