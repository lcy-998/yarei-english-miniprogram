# G0 页面—素材映射

| 页面 | 素材 | 用法 | 禁止事项 |
| --- | --- | --- | --- |
| P-01 | `brand-logo.png` | 顶部品牌标识，等比缩放 | 不裁切徽标、不重绘文字 |
| P-01 | `mascot-learning-blue.png` | 登录欢迎引导，透明叠放于背景上 | 不承载表单或按钮 |
| P-01 | `student-public-natural-background-v1.png` | 全页环境背景，`cover` | 不在图片上叠加业务文字后再导出 |
| S-01 | `mascot-learning-blue.png` | 问候区辅助视觉 | 不遮挡通知、标题或任务卡 |
| S-01 | `student-public-natural-background-v1.png` | 环境背景，中央保持卡片可读 | 不用于家长/教师/后台主内容区 |
| 后续口语/跟读页 | `mascot-speaking-pink.png` | M3 口语反馈或空状态预留 | G0 页面不强制使用，未批准页面不得提前落地 |
| G-01、T-01、A-01 | 无位图依赖 | 用令牌、SVG/代码图标与 CSS 表面实现 | 不从效果图裁切卡片、图标、文字或统计图 |

所有相对路径以 `visual-design/03-assets/production/` 为根。工程接入前可复制到工程资源目录，但不得引用 `asset/` 原始文件或 `04-pages/current/` 效果图。
