import { createNativeAdminPage } from '../admin-page'

createNativeAdminPage({
  id: 'A-02', title: '学校与班级', subtitle: '组织范围实时核验', permission: 'organization.manage',
  dataKind: 'classes',
  filterPlaceholder: '搜索班级、年级或学期', modules: [],
})
