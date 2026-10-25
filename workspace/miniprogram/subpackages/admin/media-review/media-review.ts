import { createNativeAdminPage } from '../admin-page'

createNativeAdminPage({
  id: 'A-08', title: '音视频素材管理', subtitle: '查看、预览、反馈问题和下架', permission: 'media.review',
  dataKind: 'records', recordKind: 'media',
  filterPlaceholder: '搜索素材', modules: [],
})
