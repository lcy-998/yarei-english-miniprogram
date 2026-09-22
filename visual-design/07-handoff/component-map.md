# 全项目页面—组件映射

| 页面 | 固定公共组件 | 页面专属组合 | 开发约束 |
| --- | --- | --- | --- |
| P-01 登录 | 顶部安全区、表单输入、主按钮、文字按钮、Toast | Logo、蓝色学习吉祥物、自然背景、登录卡 | 不提供注册或第三方登录；错误态不写入主稿 |
| S-01 学生首页 | 顶部安全区、通知角标、学生 Tab、进度条、任务卡、入口卡 | 问候区、今日任务卡、单词练习入口、蓝色学习吉祥物、自然背景 | 任务卡整卡进入 S-09；不新增首页阅读快捷卡 |
| G-01 家长首页 | 顶部安全区、家长 Tab、统计卡、状态标签、列表项 | 当前孩子切换、任务概览、最新点评 | 只读；不显示提交、评分或编辑操作 |
| T-01 教师工作台 | 顶部安全区、教师 Tab、入口卡、统计卡、列表项、状态标签 | 三个任务入口、待办区、班级动态 | 无吉祥物；优先信息密度与操作效率 |
| A-01 后台工作台 | 后台侧栏、顶栏账号区、指标卡、快捷入口、表格、分页/筛选 | 学校范围、时间范围、完成概览、待办与操作记录 | 不使用全屏卡通背景或吉祥物 |

组件实现采用一个公共组件源，不允许为同类按钮、卡片或导航复制页面私有样式。

## M0 工程实现

| 视觉组件 | 小程序组件 | 已接入页面 |
| --- | --- | --- |
| 页面环境层 | `components/g0-page-shell` | P-01、S-01、G-01、T-01 |
| 暖白卡片 | `components/g0-card` | P-01；其余页面可按批准主稿逐步迁移 |
| 主/次/文字按钮 | `components/g0-button` | P-01 |
| 带前后缀的输入框与错误提示 | `components/g0-input` | P-01 |
| 代码原生功能图标 | `components/g0-icon` | S-01、G-01、T-01 |
| 角色底部导航 | `components/g0-tab-bar` | S-01、G-01、T-01 |
| 顶栏、角标与状态反馈 | `components/app-header`、`components/state-panel` | 所有 M0 页面 |

生产位图从 `miniprogram/assets/g0/` 引用；效果图目录和 `visual-design/03-assets/production/` 不被小程序运行时直接引用。

## G2—G4 页面分组映射

| 页面组 | 公共组件 | 专属组件 | 状态板 |
| --- | --- | --- | --- |
| P-03/P-04/G-02/T-02/T-03 | 导航、按钮输入、卡片列表、弹窗 Toast | 验证步骤、孩子关系、学员筛选/详情 | common、permission |
| S-02/S-03/S-04 | 导航、卡片列表、筛选 | 单词练习、阅读分类、页图阅读器 | common、permission |
| G3 教学扩展页面 | 导航、卡片列表、任务反馈、表格筛选 | 长期任务、排行榜、模板、教材/题库选择 | common、task-lifecycle |
| S-05/S-07 | 按钮输入、媒体录音、任务反馈、弹窗 Toast | 跟读原文、录音、模拟 AI 维度分 | media-recording-ai、permission |
| T-19/T-20 | 导航、按钮输入、卡片列表、媒体录音、弹窗 Toast | 媒体库、上传转码、波形时间轴、题目片段映射 | media-recording-ai、common |
| A-01—A-08 | 后台导航、按钮输入、卡片列表、表格筛选、抽屉 Toast | 组织树、权限树、内容审核、媒体审核 | common、permission、media-recording-ai |

组件视觉输入以 `02-components/*.png` 为准，行为、字段和权限仍以权威产品/交互文档为准。页面实现不得直接使用组件状态板 PNG。

## M2/M3 施工组件源

| 组件 | 代码位置 | 优先接入页面 |
| --- | --- | --- |
| 统一图标 | `miniprogram/components/visual-icon` | 全部 M2/M3 小程序页 |
| 状态标签 | `miniprogram/components/status-badge` | S-10—S-12、T-09—T-20 |
| 搜索筛选 | `miniprogram/components/filter-bar` | P-05、S-03/S-12、T-04/T-09—T-20 |
| 媒体播放器 | `miniprogram/components/media-player` | S-04/S-05/S-07、T-19/T-20 |
| 录音面板 | `miniprogram/components/recording-panel` | S-05/S-07、T-20 |

组件只提供表现、可访问状态和事件边界；防快进、播放连续性、录音保存、AI 次数、媒体审核与权限仍由领域/service 层实现。
