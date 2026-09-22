# 50 页视觉开发交付矩阵

> `主稿` 只有 `current` 可直接用于开发；标记“候选”的页面必须等待用户批准。

组件缩写：N 导航；F 按钮/输入；C 卡片/列表；D 弹窗/抽屉/Toast；M 媒体/录音；S 状态/反馈；T 表格/筛选/分页。  
状态缩写：C 公共加载空失败；P 权限/停用/下架；M 媒体/录音/AI；L 生命周期。  
响应式：L 横屏稿；Tab 平板稿；Sp 小屏/字体/键盘/弱网/冲突专项。

| ID | 页面 | 里程碑 | 主稿 | 组件 | 位图素材 | 状态 | 响应式 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P-01 | 登录 | M0 | `current/P-01.png` | N/F/C/D | Logo、学习吉祥物、自然背景 | C/P | Sp |
| P-02 | 身份选择 | M0 | `current/P-02.png` | N/C/S | 自然背景 | C/P | Sp |
| P-03 | 找回密码 | M1 | `current/P-03.png` | N/F/D/S | 无，代码图标 | C/P | Sp |
| P-04 | 个人中心 | M1 | `current/P-04.png` | N/F/C/D/S | 无，代码图标 | C/P | Sp |
| P-05 | 通知中心 | M2 | `current/P-05.png` | N/C/S | 无，代码图标 | C/P | Sp |
| S-01 | 学生首页 | M0 | `current/S-01.png` | N/C/S | 学习吉祥物、自然背景 | C/P/L | Sp |
| S-02 | 单词练习 | M1 | `current/S-02.png` | N/F/C/S | 无，代码图标 | C/P | Sp |
| S-03 | 阅读专区 | M1 | `current/S-03.png` | N/F/C/S | 五类虚构阅读封面、自然背景 | C/P | Sp |
| S-04 | 阅读详情 | M1/M3 | `current/S-04.png` | N/C/S/M | 动物园绘本封面、虚构页图、自然背景 | C/P/M | L/Sp |
| S-05 | 跟读与 AI 评分 | M3 | `current/S-05.png` | N/F/C/D/M/S | 口语吉祥物、录音重试插画、自然背景 | C/P/M | L/Sp |
| S-06 | 自然拼读 | M2 | `current/S-06.png` | N/F/C/S | 无，代码图标 | C/P | Sp |
| S-07 | 视频配音 | M2/M3 | `current/S-07.png` | N/F/C/D/M/S | 录音重试插画、自然背景 | C/P/M | L/Sp |
| S-08 | 我的任务 | M0 | `current/S-08.png` | N/F/C/S | 自然背景 | C/P/L | Sp |
| S-09 | 任务详情 | M0 | `current/S-09.png` | N/F/C/D/S | 自然背景；任务内容图由资源提供 | C/P/L | L/Sp |
| S-10 | 我的班级 | M2 | `current/S-10.png` | N/C/S | 同步教材虚构封面 | C/P | Sp |
| S-11 | 打卡排行榜 | M2 | `current/S-11.png` | N/C/S | 无，代码图标/头像占位 | C/P/L | Sp |
| S-12 | 我的作品 | M2/M3 | `current/S-12.png` | N/C/M/S | 录音重试插画 | C/P/M | Sp |
| G-01 | 家长首页 | M0 | `current/G-01.png` | N/C/S | 无，代码图标 | C/P/L | Sp |
| G-02 | 孩子管理 | M1 | `current/G-02.png` | N/F/C/D/S | 无，代码图标 | C/P | Sp |
| G-03 | 孩子任务 | M0 | `current/G-03.png` | N/C/S | 自然背景 | C/P/L | Sp |
| G-04 | 学习报告 | M2 | `current/G-04.png` | N/F/C/S/T | 图表由代码渲染 | C/P | Sp |
| G-05 | 反馈详情 | M0 | `current/G-05.png` | N/C/M/S | 自然背景；音频控件代码渲染 | C/P/L | Sp |
| T-01 | 教师工作台 | M0 | `current/T-01.png` | N/C/S | 自然背景，低装饰遮罩 | C/P/L | Sp |
| T-02 | 学员列表 | M1 | `current/T-02.png` | N/F/C/D/S/T | 无，代码图标/头像占位 | C/P | Sp |
| T-03 | 学员详情 | M1 | `current/T-03.png` | N/C/S/T | 无，代码图标/头像占位 | C/P | Sp |
| T-04 | 学员统计 | M2 | `current/T-04.png` | N/F/C/S/T | 图表由代码渲染 | C/P | Sp |
| T-05 | 任务中心 | M0 | `current/T-05.png` | N/C/S | 自然背景 | C/P/L | Sp |
| T-06 | 布置任务 | M0/M2 | `current/T-06.png` | N/F/C/D/S | 自然背景；内容图由资源提供 | C/P/L | Sp |
| T-07 | 任务检查列表 | M0 | `current/T-07.png` | N/F/C/D/S/T | 自然背景 | C/P/L | Sp |
| T-08 | 快速点评 | M0/M3 | `current/T-08.png` | N/F/C/D/S | 自然背景；AI 建议用代码状态 | C/P/L | Sp |
| T-09 | 长期任务 | M2 | `current/T-09.png` | N/F/C/D/S/T | 无，代码图标 | C/P/L | Sp |
| T-10 | 任务模板 | M2 | `current/T-10.png` | N/F/C/D/S | 无，代码图标 | C/P/L | Sp |
| T-11 | 教材中心 | M2 | `current/T-11.png` | N/F/C/S | 虚构教材/阅读封面 | C/P | Sp |
| T-12 | 班级教材大盘 | M2 | `current/T-12.png` | N/F/C/S/T | 同步教材虚构封面 | C/P | Sp |
| T-13 | 班级课本详情 | M2 | `current/T-13.png` | N/F/C/D/S | 同步教材虚构封面 | C/P | Sp |
| T-14 | 同步学教材 | M2 | `current/T-14.png` | N/F/C/D/S | 同步教材虚构封面 | C/P | Sp |
| T-15 | 学校习题库 | M2 | `current/T-15.png` | N/F/C/D/S/T | 无，题目内容由数据组件渲染 | C/P | Sp |
| T-16 | 阅读内容选择 | M2 | `current/T-16.png` | N/F/C/D/S | 五类虚构阅读封面、虚构页图 | C/P | Sp |
| T-17 | 完成情况 | M0 | `current/T-17.png` | N/F/C/D/S/T | 自然背景 | C/P/L | Sp |
| T-18 | 课堂任务内容选择 | M2 | `current/T-18.png` | N/F/C/D/S | 虚构教材/阅读封面 | C/P/M | Sp |
| T-19 | 音视频材料库 | M3 | `history/T-19/v001.png` 候选 | N/F/C/D/M/S/T | 媒体空状态插画；缩略图代码渲染 | C/P/M | Sp |
| T-20 | 媒体编辑与题目对位 | M3 | `current/T-20.png` | N/F/C/D/M/S | 录音重试插画 | C/P/M | L/Sp |
| A-01 | 后台工作台 | M1 | `current/A-01.png` | N/C/S/T | Logo；图表代码渲染 | C/P | Sp |
| A-02 | 学校/班级管理 | M1 | `current/A-02.png` | N/F/C/D/S/T | Logo；其余代码图标 | C/P | Tab/Sp |
| A-03 | 用户管理 | M1 | `current/A-03.png` | N/F/C/D/S/T | Logo；头像占位代码/虚构 | C/P | Tab/Sp |
| A-04 | 权限管理 | M1 | `current/A-04.png` | N/F/C/D/S/T | Logo；权限树代码渲染 | C/P | Sp |
| A-05 | 教材中心管理 | M2 | `current/A-05.png` | N/F/C/D/S/T | Logo、同步教材虚构封面 | C/P | Sp |
| A-06 | 学校习题库管理 | M2 | `current/A-06.png` | N/F/C/D/S/T | Logo；题目代码渲染 | C/P | Sp |
| A-07 | 任务与活动管理 | M2 | `current/A-07.png` | N/F/C/D/S/T | Logo；状态与表格代码渲染 | C/P/L | Sp |
| A-08 | 音视频审核管理 | M3 | `history/A-08/v001.png` 候选 | N/F/C/D/M/S/T | Logo、媒体空状态插画 | C/P/M | Tab/Sp |

## 位图名称

- Logo/吉祥物/背景：`brand-logo.png`、`mascot-learning-blue.png`、`mascot-speaking-pink.png`、`student-public-natural-background-v1.png`。
- 状态：`media-library-empty-v1.png`、`recording-ai-retry-v1.png`。
- 阅读/教材：`demo-zoo-picture-book-cover-v1.png`、`demo-zoo-page-02-v1.png`、`demo-sync-textbook-cover-v1.png`、`demo-original-reader-cover-v1.png`、`demo-current-affairs-cover-v1.png`、`demo-chapter-reader-cover-v1.png`。

所有相对主稿路径均以 `visual-design/04-pages/` 为根；素材路径以 `visual-design/03-assets/production/` 为根。
