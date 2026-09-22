# M2/M3 视觉施工基础包

> 基线：0.18.0。用途是让页面开发和 AI 代码生成引用确定的令牌、图标、组件状态和生产素材；不代表 M2/M3 功能已进入开发。

## 可直接读取的输入

- 机器令牌：`01-foundations/design-tokens.json`。
- 小程序令牌镜像：`workspace/miniprogram/styles/design-tokens.less`，由 `app.less` 统一引入。
- 后台令牌镜像：`workspace/admin-console/src/design-tokens.css`。
- 图标清单：`03-assets/icons/icon-manifest.json`；12 个 24px、2px 圆角描边 SVG，运行副本位于 `workspace/miniprogram/assets/icons/`。
- 组件契约：`02-components/code-component-contract.json`。
- 页面输入：`07-handoff/page-delivery-matrix.md`、`component-map.md`、`page-asset-map.md`。

## 小程序组件骨架

| 组件 | 用途 | 当前边界 |
| --- | --- | --- |
| `visual-icon` | 统一引用生产 SVG | 不允许页面自画同名图标 |
| `status-badge` | 任务、提交、媒体、审核状态 | 状态必须有文字，不只依赖颜色 |
| `filter-bar` | M2/M3 列表搜索与筛选入口 | 业务筛选条件由页面提供 |
| `media-player` | 倍速、磨耳朵、不可快进及异常外观 | 只提供视觉与事件契约，不实现播放/防快进业务规则 |
| `recording-panel` | 录音、上传、生成、失败保留的视觉状态 | 只提供视觉与事件契约，不调用录音或 AI 服务 |

页面通过 `usingComponents` 显式接入；不得复制组件 Less 到页面。波形、进度、状态文字由代码渲染，不从状态板裁图。

后台统一从 `workspace/admin-console/src/components/visual-foundation.tsx` 复用 `SemanticStatus`、`FilterToolbar`、`ProgressBar`、`SideDrawer` 和 `ReviewCheckList`，用于 A-05—A-08 的筛选、状态、进度和审核详情；具体字段、权限与写操作仍由页面和 service 提供。

## 自动检查

`workspace/npm run visual:check` 现在同时检查：

1. M0 已批准主稿；
2. M2 的 20 张已批准主稿；
3. M3 已批准稿与 T-19/A-08 待审批候选边界；
4. 7 张组件板、4 张状态板和 10 张响应式/专项板；
5. 全部生产素材清单与文件引用；
6. 机器令牌及小程序/后台镜像；
7. SVG 图标源与运行副本一致性；
8. 五个施工组件的四件套文件完整性；
9. 小程序 WXML 本地图片引用不存在缺失。

该检查验证交付结构和确定性，不替代微信开发者工具编译、运行截图对比、真机、可访问性或业务测试。
