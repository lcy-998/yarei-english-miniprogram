# G0 页面—素材映射

| 页面 | 素材 | 用法 | 禁止事项 |
| --- | --- | --- | --- |
| P-01 | `brand-logo.png` | 顶部品牌标识，等比缩放 | 不裁切徽标、不重绘文字 |
| P-01 | `mascot-learning-blue.png` | 登录欢迎引导，透明叠放于背景上 | 不承载表单或按钮 |
| P-01 | `student-public-natural-background-v1.png` | 全页环境背景，`cover` | 不在图片上叠加业务文字后再导出 |
| S-01 | `mascot-learning-blue.png` | 问候区辅助视觉 | 不遮挡通知、标题或任务卡 |
| S-01 | `student-public-natural-background-v1.png` | 环境背景，中央保持卡片可读 | 不用于家长/教师/后台主内容区 |
| T-01 | `student-public-natural-background-v1.png` | 按用户确认复用为教师工作台环境背景，通过教师页遮罩降低装饰密度 | 不承载吉祥物、业务文字或数据 |
| 后续口语/跟读页 | `mascot-speaking-pink.png` | M3 口语反馈或空状态预留 | G0 页面不强制使用，未批准页面不得提前落地 |
| G-01、A-01 | 无位图依赖 | 用令牌、SVG/代码图标与 CSS 表面实现 | 不从效果图裁切卡片、图标、文字或统计图 |

M0 次级任务页允许复用 `student-public-natural-background-v1.png` 作为统一环境底图，但必须通过公共暖白遮罩保持内容可读；T-05/T-07 任务中心可保留更完整景深，S-08/S-09、G-03/G-05、T-06/T-08/T-17 使用“顶部天空与底部植物清晰、中部暖白”的统一次级页规则。

所有相对路径以 `visual-design/03-assets/production/` 为根。工程接入前可复制到工程资源目录，但不得引用 `asset/` 原始文件或 `04-pages/current/` 效果图。
