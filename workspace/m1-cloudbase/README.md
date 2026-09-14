# M1 CloudBase 本地前置代码

此目录是 `雅睿英语` 的隔离 M1 本地骨架，当前基线为 0.14.0。它不替换 M0 memory repository、不被小程序页面导入，也不包含 CloudBase SDK、真实环境 ID、账号、密钥、部署或数据导入逻辑。

## 本地运行

在本目录执行：

```powershell
npm install
npm run typecheck
npm test
npm run check
```

工具链复用父目录 `workspace/node_modules` 的 TypeScript 与 Vitest；本包没有运行时依赖。首次实际 CloudBase 联调前，必须先完成 M0 退出、代码审阅和用户允许的环境操作。

## 实现状态

- 已实现：`m1.v1` 线协议、严格输入解析、错误映射、可信 actor 解析接口、幂等键/请求摘要、CloudBase repository adapter 调用边界，以及 11 个函数的安全占位入口。
- 尚未实现：CloudBase SDK 连接、平台身份读取、数据库事务、业务查询/写入、种子导入、认证、部署和函数安全规则发布。
- 函数入口只校验公共协议后返回 `SERVICE_UNAVAILABLE`；这是刻意的未配置保护，不是可部署业务实现。

## 未来接入点

在 M0 退出后，在 `workspace/miniprogram/repositories/` 新增 repository factory 的 CloudBase 分支；它只依赖本目录 `src/repositories/cloudbase-adapter.ts` 的 `CloudFunctionInvoker`，将既有 service command 映射到函数 action。页面、WXML、Less、`app.json` 和 M0 domain/service 不应直接导入本目录。

真实配置仅可从 `docs/m1-cloudbase/templates/.env.example` 复制为本机未提交的 `.env.local`，并保持 `TCB_ENV_ID` 为空，直到用户明确允许配置和联调。
