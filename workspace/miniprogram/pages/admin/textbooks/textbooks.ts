import { createNativeAdminPage } from '../../../subpackages/admin/admin-page'

createNativeAdminPage({
  id: 'A-05', title: '教材中心管理', subtitle: '目录、可见范围与版本', permission: 'textbook.manage',
  dataKind: 'records', recordKind: 'textbooks',
  filterPlaceholder: '搜索教材', modules: [
    { id: 'catalog', title: '教材目录', description: '班级教材和同步学教材' },
    { id: 'visibility', title: '可见班级', description: '发布前核对授权范围' },
    { id: 'preview', title: '教师视角预览', description: '基础页图不代表完整媒体审核' },
  ],
})
