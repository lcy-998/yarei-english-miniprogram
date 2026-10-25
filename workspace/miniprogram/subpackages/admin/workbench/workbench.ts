import { createNativeAdminPage } from '../admin-page'

createNativeAdminPage({
  id: 'A-01', title: '管理工作区', subtitle: '选择要办理的事项', permission: 'dashboard.read',
  filterPlaceholder: '搜索管理功能', modules: [
    { id: 'organizations', title: '学校与班级', description: '学校、班级和教师分配', route: '/subpackages/admin/organizations/organizations', permission: 'organization.manage' },
    { id: 'users', title: '用户管理', description: '账号和家长绑定关系', route: '/subpackages/admin/users/users', permission: 'user.manage' },
    { id: 'permissions', title: '权限管理', description: '逐账号功能权限与授权范围', route: '/subpackages/admin/permissions/permissions', permission: 'authorization.manage' },
    { id: 'questions', title: '学校习题库管理', description: '预览题目和上下架', route: '/subpackages/admin/questions/questions', permission: 'question.manage' },
    { id: 'media-review', title: '音视频素材管理', description: '查看、预览、反馈和下架', route: '/subpackages/admin/media-review/media-review', permission: 'media.review' },
  ],
})
