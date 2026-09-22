# G0 页面—素材映射

| 页面 | 素材 | 用法 | 禁止事项 |
| --- | --- | --- | --- |
| P-01 | `brand-logo.png` | 顶部品牌标识，等比缩放 | 不裁切徽标、不重绘文字 |
| P-01 | `mascot-learning-blue.png` | 登录欢迎引导，透明叠放于背景上 | 不承载表单或按钮 |
| P-01 | `student-public-natural-background-v1.png` | 全页环境背景，`cover` | 不在图片上叠加业务文字后再导出 |
| S-01 | `mascot-learning-blue.png` | 问候区辅助视觉 | 不遮挡通知、标题或任务卡 |
| S-01 | `student-public-natural-background-v1.png` | 环境背景，中央保持卡片可读 | 不用于家长/教师/后台主内容区 |
| T-01 | `student-public-natural-background-v1.png` | 按用户确认复用为教师工作台环境背景，通过教师页遮罩降低装饰密度 | 不承载吉祥物、业务文字或数据 |
| S-05 | `mascot-speaking-pink.png` | 顶部口语引导；直接使用官方透明素材 | 不从效果图裁切，不修改身份、服装、颜色或面部 |
| T-19、A-08 | `media-library-empty-v1.png` | 媒体列表空状态 | 正常有数据主稿不展示；不得烘焙说明文字或按钮 |
| S-05、S-07、T-20 | `recording-ai-retry-v1.png` | 录音保留、AI/上传重试等复杂空状态 | 不代替状态文字、进度或真实录音波形 |
| S-03、S-04、T-16、T-18 | `demo-zoo-picture-book-cover-v1.png` | 虚构《A Day at the Zoo》封面缩略图 | 不把书名烘焙进封面；标题由组件渲染 |
| S-04、T-16 | `demo-zoo-page-02-v1.png` | M1 虚构绘本高清页图 | 不在页图外显示 OCR 正文；不得当作真实教材 |
| T-12/T-13/T-14/T-18/A-05 | `demo-sync-textbook-cover-v1.png` | 同步教材虚构封面 | 不显示真实出版社、年级文字或版本标识 |
| S-03、T-16、T-18 | `demo-original-reader-cover-v1.png` | 原版材料分类虚构封面 | 开发/测试专用，不宣称真实授权 |
| S-03、T-16、T-18 | `demo-current-affairs-cover-v1.png` | 时文阅读分类虚构封面 | 不使用真实新闻照片、媒体品牌或文字 |
| S-03、T-16、T-18 | `demo-chapter-reader-cover-v1.png` | 英语章节阅读分类虚构封面 | 标题、等级和章节由 UI 组件显示 |
| G-01、A-01 | 无位图依赖 | 用令牌、SVG/代码图标与 CSS 表面实现 | 不从效果图裁切卡片、图标、文字或统计图 |

M0 次级任务页允许复用 `student-public-natural-background-v1.png` 作为统一环境底图，但必须通过公共暖白遮罩保持内容可读；T-05/T-07 任务中心可保留更完整景深，S-08/S-09、G-03/G-05、T-06/T-08/T-17 使用“顶部天空与底部植物清晰、中部暖白”的统一次级页规则。

所有相对路径以 `visual-design/03-assets/production/` 为根。工程接入前可复制到工程资源目录，但不得引用 `asset/` 原始文件或 `04-pages/current/` 效果图。

基础功能图标、播放器控件、波形、时间轴、评分环、状态标签、表格和图表均使用 SVG/WXML/CSS/Canvas 实现，不从页面或状态板截图裁切。
