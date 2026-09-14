# 雅睿英语微信小程序

雅睿英语面向学生、家长和教师，目标是形成“教师布置任务 → 学生完成并提交 → 教师检查点评 → 家长查看结果”的学习闭环，并在后续阶段通过独立管理后台支撑学校运营。

## 当前阶段

当前只执行 **M0 可运行核心原型（目标版本 0.1）**。M0 使用统一虚构数据验证竖屏主路径和跨角色数据一致性，不接入真实账号、云数据库、教材、AI、媒体转码或订阅消息。

产品范围和验收口径以 `DOCUMENTATION.md` 指向的权威文档为准。工程方案详见：

- `docs/architecture.md`
- `docs/m0-implementation-plan.md`
- `docs/data-model.md`
- `docs/service-contracts.md`
- `docs/testing-strategy.md`

## 技术栈

- 微信原生小程序
- TypeScript、WXML、Less
- Vitest（纯业务逻辑与 service 合约测试）
- M0：内存模拟 repository
- M1 规划：微信云开发 CloudBase（云函数、云数据库、云存储）
- 后续独立管理后台规划：React + TypeScript + Vite

## 目录

```text
app/
├─ DOCUMENTATION.md                 # 文档索引、权威顺序与版本基线
├─ product-requirements-core.md     # 产品范围、规则、里程碑、验收
├─ page-interaction-spec.md         # 页面与交互规格
├─ docs/                            # 技术设计与实施说明
└─ workspace/                       # 微信小程序工程（开发者工具导入目录）
   ├─ miniprogram/                  # 小程序源码
   ├─ typings/                      # 微信 API 类型声明
   ├─ package.json                  # 本地验证命令和开发依赖
   ├─ project.config.json           # 微信项目公共配置
   └─ tsconfig.json                 # TypeScript 严格检查配置
```

## 环境准备

1. 安装 Node.js 22.12+、24.x 或更高受支持的偶数版本及 npm（与 Vitest 5 的运行要求一致）。
2. 安装微信开发者工具，并确保版本支持 TypeScript 与 Less 编译插件。
3. 在 `workspace/` 中安装开发依赖：

```powershell
cd D:\app\workspace
npm install
```

本项目不要求在前端配置任何服务端密钥。后续 CloudBase、AI 或媒体服务的敏感配置只能放在服务端环境中。

## 本地验证

在 `workspace/` 中运行：

```powershell
npm run typecheck  # TypeScript 静态检查
npm test           # Vitest 单次运行
npm run check      # 依次执行类型检查、现有检查脚本和业务测试
```

当前基础阶段可能尚无业务测试文件；此时 Vitest 会明确显示无用例并正常退出。开始实现领域逻辑后，每条核心规则必须有对应单测，不能把“工具链可运行”当作“业务已验证”。

## 导入微信开发者工具

1. 打开微信开发者工具，选择“导入项目”。
2. 项目目录选择 `D:\app\workspace`，不要选择 `miniprogram/` 子目录。
3. 工具会读取 `project.config.json` 中的 `miniprogramRoot`、TypeScript 和 Less 配置。
4. 使用有权限的测试 AppID，或按开发者工具提示使用本地测试身份。
5. 导入后先执行一次“编译”，确认模板页面仍能正常打开；M0 页面实现完成后再按测试策略验证完整链路。

`project.private.config.json` 是开发者工具的个人本地配置，已被 Git 忽略，不应提交。

## 开发约定

- 页面不直接读取模拟数据；统一通过 service/repository 接口访问。
- 页面状态保持简单、局部、类型明确，M0 不引入状态管理框架。
- 任务、学生任务关系、提交版本和点评分别建模。
- 模拟数据只使用虚构信息，且不同角色页面必须引用同一份底层记录。
- 提交审核、正式发布、生产数据修改和付费服务开通必须先得到用户确认。
