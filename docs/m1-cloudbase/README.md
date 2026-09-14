# M1 CloudBase 前置设计索引

本目录是与 M0 并行但隔离的 M1 后端准备，不表示 M1 已开工，不覆盖权威产品/交互文档，也不要求修改 M0 页面。

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

本任务开始时读取的权威基线为 0.11.3；当前已复核至 0.15.0。后续的视觉资料清理没有改变 M1 后端核心闭环范围。本目录仍从属于权威产品与交互文档，且未修改任何权威文档。

## 本地前置代码（2026-09-13）

`workspace/m1-cloudbase/` 只实现 `m1.v1` 协议、错误映射、可信 actor 接口、幂等请求摘要、CloudBase adapter 边界和函数占位入口；不含 CloudBase SDK、envId、认证、数据库操作、种子导入或部署。请在该目录运行 `npm install`、`npm run typecheck`、`npm test`、`npm run check`。所有函数在未注入已评审的 CloudBase 运行时与业务 handler 前均返回 `SERVICE_UNAVAILABLE`，不得将其部署或接到 M0 页面。
