# S-01 首页云函数运行依赖修复：非生产审阅包

日期：2026-10-07  
状态：用户已授权；非生产云端单函数修复已执行，匿名鉴权探针通过；已登录学生首页回归待确认。

## 故障证据

学生首页 `student-task-query.getHome` 返回 `SERVICE_UNAVAILABLE`。结构正确的匿名云端调用也在鉴权前返回同一错误，而 `activity-query.listForStudent` 和 `auth-session.getCurrentSession` 返回预期的 `UNAUTHENTICATED`。这排除了学生资料、任务数据和客户端环境 ID 作为该次错误的直接原因。

当前云端 `student-task-query` 为 `Active`，`Nodejs20.19`，10 秒、256 MB，`InstallDependency=false`，无层、无触发器；六个既有环境变量值均存在。2026-10-06 的代码包 SHA-256 为 `17F2ECC5F1797DE513083A64D89AB5FB8A938F7875CBCB3BDD36E758E1714588`。该包只有 `index.js` 和 `package.json`，入口仍执行 `require('@cloudbase/node-sdk')`，却没有随包附带该 SDK。部署脚本以 external 排除 SDK，同时显式关闭云端依赖安装，形成了初始化缺口。既有引导代码会把初始化失败转换成统一 `SERVICE_UNAVAILABLE`，因此 `Active` 状态和代码哈希核对未暴露故障。

## 拟执行变更

- 环境：现有非生产 CloudBase 个人版环境，仅使用虚构账号与数据；环境当前为 `NORMAL`，`EnableOverrun=false`，`EnvPaid=no`，`EnvCharged=no`。
- 目标：只更新现有 `student-task-query` 一只函数的代码包，不改业务代码、数据、集合、索引、访问规则、环境变量、路由、超时、内存、依赖安装开关或其他函数。
- 包来源：以已读回的当前云端入口文件为唯一业务代码输入，原 SHA-256 如上；用已锁定的 `@cloudbase/node-sdk@3.18.3` 构建内嵌 SDK 的单文件包。构建脚本为 `workspace/m1-cloudbase/tools/build-student-task-query-runtime-repair-20261007.mjs`；生成入口 SHA-256 为 `6FFAA00CAF094B2E5989FAD0431A291D01191C75C507AC89613C8130DCDF8E15`，大小 2,480,418 字节。生成文件位于 Git 忽略的 `workspace/m1-cloudbase/dist/student-task-query-runtime-repair-20261007/`。
- 本地验证：修复包复制到无 `node_modules` 的隔离目录，使用既有非生产测试配置调用合法匿名 `getHome`，返回预期 `UNAUTHENTICATED`；旧云端包同样调用返回 `SERVICE_UNAVAILABLE`。SDK 的可选 `supports-color` 引用未随包引入，隔离验证通过。

## 执行门禁与回退

1. 部署前重新核对环境为上述免费非生产环境、超限按量仍关闭，函数代码仍是原哈希、配置和路由未变化；读取当前函数包作不可变备份。若读回失败或任何基线变化，停止。
2. 仅执行目标函数代码更新，仍保持 `InstallDependency=false`；部署后读回代码哈希、配置、环境变量键和值、`$LATEST` 路由及 `Active` 状态。
3. 用合法匿名调用确认 `UNAUTHENTICATED`，再用已授权虚构学生确认 `getHome` 返回本人今日任务，用其他角色及跨组织会话确认拒绝。开发者工具已登录首页需人工复测。
4. 若任何部署后校验失败，恢复部署前函数包与原配置并复核哈希、状态和路由；记录首页仍可能不可用，不触碰业务数据。

本包不授权生产环境、真实用户数据、付费开通、账号密码重置、其他 M3 功能部署或正式发布。任何费用状态变化均须停止并重新确认。此前媒体草稿投影部署的授权限定代码与配置不变，本次内嵌 SDK 的修复包需单独确认后执行。

## 执行记录（2026-10-07）

- 用户明确要求先修复云端，授权本包的非生产单函数修复。重新核对环境为 `NORMAL` 的个人版，超限按量关闭，未付费；目标函数原状态为 `Active`，`Nodejs20.19`、10 秒、256 MB、`InstallDependency=false`、六个环境变量有值、无触发器，路由为 `$LATEST` 且无加权流量。
- 默认系统 DNS 无法解析代码下载 COS 域名。仅对这次 CloudBase CLI 下载进程使用独立 DNS 解析设置，HTTPS 主机名及证书校验不变，未改系统 DNS。部署前成功下载当前包，入口 SHA-256 为原审阅哈希 `17F2ECC5F1797DE513083A64D89AB5FB8A938F7875CBCB3BDD36E758E1714588`，保存在忽略目录 `.runtime/student-task-query-pre-repair-20261007/`。
- 首次 `fn code update` 上传修复包成功，但 CLI 自动把 `InstallDependency` 改为 `true`；随后用只含目标函数的隔离配置显式执行 `fn deploy --install-dependency false`，恢复原设置。最终函数为 `Active`，配置为原 `Nodejs20.19`、10 秒、256 MB、六个环境变量键和值均匹配、无触发器、`InstallDependency=false`，路由仍为 `$LATEST` 且无加权流量。
- 部署后重新下载代码，入口 SHA-256 为修复包哈希 `6FFAA00CAF094B2E5989FAD0431A291D01191C75C507AC89613C8130DCDF8E15`。合法匿名 `getHome` 云端调用由部署前的 `SERVICE_UNAVAILABLE` 变为预期的 `UNAUTHENTICATED`，证明函数初始化恢复；该探针不代表已登录学生首页或任务数据回归已通过。
- 未改其他函数、数据库、账号、密码、环境变量、生产环境或发布渠道。已登录学生页面回归等待用户在开发者工具点击重试确认。
