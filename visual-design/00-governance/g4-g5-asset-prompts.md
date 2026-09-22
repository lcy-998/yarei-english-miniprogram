# G4/G5 组件、状态、素材与响应式提示词记录

> 生成方式：Codex 内置 ImageGen。生成日期：2026-09-16。所有位图均使用已批准页面作为风格参考；不得把组件板或页面稿直接打包进运行时。

## 组件状态板

| 输出 | 核心提示 | 参考 |
| --- | --- | --- |
| `02-components/navigation.png` | 跨学生/家长/教师/后台的安全区、Tab、侧栏和账号栏；默认/选中/按下/禁用 | S-01、T-11、A-01 |
| `02-components/buttons-and-inputs.png` | 主次危险文字图标按钮，以及输入、搜索、选择、日期、多行、上传和复选状态 | T-20、A-02 |
| `02-components/cards-and-lists.png` | 内容、任务、统计、入口、媒体、学生和后台表格行的默认/按下/选择/禁用/加载 | S-03、T-19、A-07 |
| `02-components/dialogs-drawers-toast.png` | 确认、未保存离开、底部弹窗、右抽屉、Toast 和顶部通知 | A-08、T-15 |
| `02-components/media-and-recording.png` | 播放、倍速、磨耳朵、防快进、录音、上传和模拟 AI 成功/失败 | S-05、S-07、T-20 |
| `02-components/task-status-and-feedback.png` | 任务、学生任务、提交、媒体、反馈状态，进度、步骤、角标和反馈卡 | T-07、T-17、T-19 |
| `02-components/tables-filters-pagination.png` | 桌面/移动筛选、表格、排序、多选、分页、加载/空/错误 | A-07、A-03、T-02 |

统一约束：暖白不透明背景、品牌蓝和语义状态色、粗圆角图标、文字和图标共同表达；无吉祥物、无真实数据、无水印、无完整页面截图。

## 异常状态板

| 输出 | 核心提示 |
| --- | --- |
| `05-states/common-loading-empty-error.png` | 加载、空、失败、刷新失败保留旧数据、提交失败保留输入、重试成功 |
| `05-states/permission-disabled-offline.png` | 未登录、无权限、账号停用、解绑、下架、禁用、会话过期 |
| `05-states/media-recording-ai.png` | 麦克风、录音保留、上传/转码失败、AI 生成/失败/低置信度、映射缺失、防快进 |
| `05-states/task-lifecycle.png` | 任务、学生任务、提交版本、反馈循环和四类业务例外；状态维度不得合并 |

统一约束：失败保留输入、录音和筛选；无权限不泄露对象存在性；模拟 AI 不宣称生产能力。

## 透明生产素材

### `media-library-empty-v1.png`

生成一个透明背景的媒体库复杂空状态插画：暖白文件夹、蓝色音频波形卡、紫色视频卡、绿色叶片和小型橙色闪光。不得包含文字、Logo、吉祥物、人物、按钮或状态。

### `recording-ai-retry-v1.png`

生成一个透明背景的录音/AI 重试插画：紫色麦克风、波形丝带、AI 闪光和蓝色重试箭头，表达“录音已保留，可以重试”。不得包含文字、Logo、吉祥物、人物、按钮或分数。

## 响应式补充稿

- `06-responsive/landscape/S-04.png`：页图约占左侧 62%，右侧为章节/页码/进度/翻页；页图外不显示 OCR 正文。
- `landscape/S-05.png`：左侧原文与录音，右侧评分与确认；粉色口语吉祥物只作头部点缀。
- `landscape/S-07.png`：左侧视频，右侧字幕与录音；保留不可快进和提交作品。
- `landscape/S-09.png`：左侧任务摘要/内容，右侧当前内容与草稿；保存/提交持续可达。
- `landscape/T-20.png`：媒体、基础信息、题目片段映射三栏。
- `tablet/A-02.png`：侧栏折叠为图标轨；组织树与班级表上下布局。
- `tablet/A-03.png`：用户列表与详情并列，主操作和筛选持续可达。
- `tablet/A-08.png`：列表在上、审核详情为下半屏抽屉。
- `supplemental/small-screen-accessibility.png`：375×812、200% 字体、长文本与滚动。
- `supplemental/keyboard-weak-network-conflict.png`：键盘、弱网保留旧数据、并发冲突保留输入。

统一约束：响应式稿是布局依据，不替代唯一 `current` 主稿；不得新增权威规格外的功能，实际运行仍需开发者工具和真机验证。

## 虚构阅读内容生产素材

- `demo-zoo-picture-book-cover-v1.png`：透明背景的原创动物园绘本书体，包含长颈鹿、大象、企鹅与狮子，无文字、Logo、出版方或版权角色。
- `demo-zoo-page-02-v1.png`：原创动物园竖版绘本页图，孩子仅为无真实身份的虚构角色；页面无文字、按钮和 UI。
- `demo-sync-textbook-cover-v1.png`：透明背景蓝色同步教材书体，天空/云/层叠山丘与书签，无书名和出版社。
- `demo-original-reader-cover-v1.png`：透明背景绿色原版阅读书体，地球、叶片与路径意象，无文字。
- `demo-current-affairs-cover-v1.png`：透明背景橙青时文阅读书体，熊猫、地球、叶片与版面块，无文字或真实照片。
- `demo-chapter-reader-cover-v1.png`：透明背景紫色章节阅读书体，路径、山丘、星星与书签，无文字。

以上素材仅供开发/测试和静态原型，不代表真实教材或版权内容已经确定；真实内容接入前必须替换并完成版权审核。
