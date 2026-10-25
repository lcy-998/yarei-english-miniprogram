# S-01 学生首页服务异常恢复记录（2026-10-07）

## 现象与定位

- 学生在微信开发者工具模拟器看到“服务暂不可用，请稍后重试”，稍后恢复后又复现。该文案由小程序 CloudBase 调用层对服务不可用类异常统一生成，截图本身不能确认是 `student-task-query.getHome` 还是 `activity-query.listForStudent` 失败。
- 非生产环境配置与小程序本地配置一致；两只云函数均为 `Active`。后续用合法结构的匿名请求探测，`activity-query` 与 `auth-session` 正常返回 `UNAUTHENTICATED`，只有 `student-task-query.getHome` 在鉴权前返回 `SERVICE_UNAVAILABLE`。
- 已部署包 SHA-256 为 `17F2ECC5F1797DE513083A64D89AB5FB8A938F7875CBCB3BDD36E758E1714588`。部署包把 `@cloudbase/node-sdk` 留为运行时 `require`，但云函数配置为 `InstallDependency=false`，无层，代码包大小仅 78,196 字节；包内只有 `index.js` 与 `package.json`。该组合缺少运行所需 SDK，初始化失败被现有引导代码统一转换为 `SERVICE_UNAVAILABLE`。已用不带 `node_modules` 的隔离本地包重现，并用内嵌 SDK 的修复包证明同一合法匿名请求能走到 `UNAUTHENTICATED`。
- 原首页在组件 `attached` 与页面 `show` 时重复加载；加载过程将课堂任务、资料、通知、活动并行请求，且活动查询失败也会遮住整张首页。页面没有按 S-01 规范展示已缓存的任务摘要。

## 本地修复

- 首次加载统一交给 `show`，去掉 `attached` 的重复请求。
- 第一次首页请求若遇到可重试错误，短暂等待后自动重试一次；仍失败时，同一学生、同一会话、同一自然日且 30 分钟内的上次成功摘要继续显示，并标明更新时间与重试入口。
- 打卡活动查询或逐日核对失败时，保留已成功取得的课堂任务，提示打卡活动未更新；只有完整成功的摘要才写入缓存。
- 页面按加载版本和会话 ID 忽略迟到的旧请求；调用层失败日志只记录函数、action、经过白名单格式校验的平台错误标识及归一化错误码，不记录账号、会话或任务内容。

## 验证与限制

- 小程序 TypeScript 类型检查通过；S-01 与 CloudBase 调用层定向测试共 16 项通过，覆盖打卡查询失败、首屏自动重试、同会话摘要恢复、跨会话缓存隔离、逐项跳转和错误映射。
- 根项目完整 `npm run check` 的类型和视觉静态检查通过；测试 1303/1304 项通过。唯一失败是工作区已有的 M3 跟读评分用例 `pronunciation-service.test.ts` 中的 `PronunciationError: CONFLICT`，单独复测仍失败，与 S-01 改动文件无交集。检查链因此中断，随后单独执行 `admin:check`，49 项后台测试、类型检查与构建通过。
- 本地首页修复阶段没有改动云端数据。随后用户授权并按 `s01-student-task-query-runtime-repair-review-2026-10-07.md` 仅修复非生产 `student-task-query` 的运行依赖，云端合法匿名 `getHome` 已由 `SERVICE_UNAVAILABLE` 恢复为预期的 `UNAUTHENTICATED`；已登录页面与真机仍待验证。
