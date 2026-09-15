# M1 CloudBase 设计与实施索引

M0 已于 2026-09-15 经用户审批通过，M1 现已开工。本目录记录 M1 后端设计、实施门禁和验证要求，不覆盖权威产品/交互文档；M0 页面及 memory repository 继续保留为回退基线。

| 文件 | 内容 |
| --- | --- |
| `environment-setup.md` | 环境准备、手动控制台步骤、命名与密钥边界 |
| `database-schema.md` | M1 集合、字段、索引、关系、软删除和 M0 映射 |
| `authorization-rules.md` | 四角色服务端授权、资源规则与越权案例 |
| `function-contracts.md` | 云函数 action、输入输出、错误码、幂等、事务和版本 |
| `migration-and-seed.md` | 虚构内存数据迁移、对账、清理和回滚 |
| `m1-test-plan.md` | 权限、幂等、并发、弱网、回归与发布门槛 |
| `open-questions.md` | 必须由用户/负责人决定的事项与决策记录 |
| `console-runbook.md` | 已确定的腾讯云方案与逐步控制台操作手册 |
| `templates/` | 不含真实环境 ID/密钥、不会自动部署的离线示例 |
| `../../workspace/m1-cloudbase/` | 隔离的本地 TypeScript 前置骨架、函数安全占位入口及 Vitest；不连接云端 |

权威顺序仍为 `DOCUMENTATION.md` 所定义顺序。本目录有冲突时服从 `product-requirements-core.md` 和 `page-interaction-spec.md`。

当前权威基线为 0.18.0。M1 只实现 `product-requirements-core.md` 与 `page-interaction-spec.md` 已列出的 M1 切片；付费、云端部署、规则发布、种子导入、真实账号/内容和生产动作仍需各自的明确授权。

## 本地代码起点（2026-09-15）

`workspace/m1-cloudbase/` 已实现 `m1.v1` 协议、错误映射、可信 actor 接口、幂等请求摘要、CloudBase adapter 边界和函数占位入口；尚不含 CloudBase SDK、envId、认证、数据库操作、种子导入或部署。请在该目录运行 `npm install`、`npm run typecheck`、`npm test`、`npm run check`。所有函数在未注入已评审的 CloudBase 运行时与业务 handler 前均返回 `SERVICE_UNAVAILABLE`。M1 首批应先完成严格 action schema、handler/database port 和 memory 合约测试，再经单独授权进入开发环境联调。
