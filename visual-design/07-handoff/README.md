# 雅睿英语视觉开发交接总索引

> 视觉源基线：0.18.0；索引校准：2026-09-29。现行产品版本与里程碑以 `DOCUMENTATION.md` 为准；本文只汇总视觉实现输入，不改变产品功能、页面字段、权限或里程碑。

## 1. 开发读取顺序

1. 根目录 `DOCUMENTATION.md`、`product-requirements-core.md`、`page-interaction-spec.md`。
2. `docs/visual-system-baseline.md`、`docs/visual-design-delivery-plan.md`、`docs/visual-page-register.md`。
3. `01-foundations/` 的颜色、字体、间距与响应式规则。
4. `02-components/` 的组件状态板与 `g4-component-spec.md`。
5. `04-pages/current/<ID>.png` 的唯一已批准正常有数据主稿。
6. `05-states/` 的异常状态板与 `06-responsive/` 的补充布局稿。
7. 本目录中的页面矩阵、素材映射、实现说明与 QA 清单。

任何冲突都服从前两级权威产品/交互文档。效果图里的数字、文案或按钮若与权威规格不一致，必须修正效果图或实现，不能反向修改产品规则。

## 2. 交付文件

| 文件 | 用途 |
| --- | --- |
| `page-delivery-matrix.md` | 50 页逐页列出里程碑、主稿、组件、素材、状态与响应式要求 |
| `design-token-contract.md` | 开发可直接采用的颜色、文字、间距、圆角、阴影与触控尺寸契约 |
| `prototype-flow-and-scenarios.md` | F-01—F-06 点击链路、虚构账号和七类评审场景 |
| `implementation-handoff.md` | 页面实现顺序、组件复用、素材导入、测试和回退规则 |
| `component-map.md` | 页面分组到公共组件的映射 |
| `page-asset-map.md` | 页面到生产位图的映射及禁止事项 |
| `visual-qa-checklist.md` | 视觉实现与运行验收检查项 |
| `delivery-status.md` | 当前完成量、审批门与唯一残余缺口 |
| `m2-m3-construction-foundation.md` | M2/M3 机器令牌、SVG 图标、组件骨架与自动检查入口 |
| `g4-review-2026-09-29.md` | S-05/T-20 已批准稿与 T-19/A-08 待审批稿的静态审阅证据和定向修改项 |
| `page-screenshot-acceptance.md` | 开发后逐页截图、叠图、状态、交互及横屏/平板验收方法 |

M3 运行用例和设备矩阵另见根目录 `docs/m3-test-baseline-2026-09-29.md`；其中“待执行”不表示已经通过。

## 3. 目录含义

- `04-pages/current/`：开发唯一可使用的已批准正常主稿；每页最多一张。
- `04-pages/history/`：候选与旧版本，仅追溯，未经批准不可开发。
- `02-components/*.png`：组件状态依据，不作为运行时图片。
- `05-states/*.png`：状态与恢复路径依据，不作为运行时图片。
- `03-assets/production/`：可复制到工程资源目录的生产位图；仍需按目标包体压缩。
- `03-assets/icons/`：代码原生图标的唯一 SVG 源；运行副本由视觉契约检查保持一致。
- `06-responsive/`：横屏、平板与专项布局依据，不替代 `current`。

## 4. 当前审批边界

- S-05、T-20 已批准并进入 `current`。
- T-19、A-08 已生成候选但仍为“待审批”；在用户明确回复“通过/采用”前不得复制到 `current` 或进入页面样式代码。
- 静态视觉交付本身不构成里程碑开工许可；M2 当前开发中，M3 未开始，均以权威产品文档的阶段状态为准。

## 5. 禁止事项

- 不从效果图或状态板裁切按钮、文字、图标、波形、评分环、表格或图表。
- 不把真实教材、真实媒体、真实手机号、真实儿童资料或未授权内容放进开发素材。
- 不用页面私有样式复制公共按钮、输入、卡片、导航和状态组件。
- 不用主稿代替空、错、无权限、下架、过期、弱网和并发冲突验收。
