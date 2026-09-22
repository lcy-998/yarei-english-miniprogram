# 雅睿英语 M1 管理后台

本目录是 A-01～A-04 的可运行切片，使用 React、TypeScript 和 Vite。默认启动仍使用统一虚构数据和内存 repository；只有显式提供 `VITE_CLOUDBASE_ENV_ID` 与浏览器端 `window.cloudbase` SDK 时，页面才显示独立后台登录并切换到 CloudBase 客户端。

`src/cloud/` 已提供本地可测试的 `organization-admin` action 合约、严格响应 view model、错误映射和可注入 transport。该边界只接受 `audience=admin-console` 的独立后台会话；小程序会话、过期会话和未配置会话均在发起调用前失败关闭。

`admin-session` 的可注入 invoker、严格 transport、客户端和仅内存会话存储也已就绪，覆盖 `bootstrap`、`refresh`、`getCurrentSession`、`logout`。除首次 bootstrap 外均使用独立后台令牌，退出携带幂等操作标识；令牌不会写入浏览器持久存储，过期、调用失败或响应不合约时会安全清除。`cloudbase-admin-runtime.ts` 现可在调用方显式传入已批准环境 ID 和浏览器 SDK 后，把平台密码认证、独立后台会话与 `organization-admin` 调用绑定到同一个 SDK app；创建运行时本身不登录、不读环境变量、不发起云函数调用。

管理端已接入 `admin-session` 与 `organization-admin` 客户端：登录成功后使用后台专属短期业务会话，A-01 概览、A-02 组织/班级、A-03 用户（含展示姓名编辑）、A-04 角色与审计读取及班级/用户/授权写操作均经过严格 transport 和 view-model 校验。未配置运行时、会话失效或云端不可用时不会隐式调用云端，页面保留内存回退并提示安全错误；密码重置和亲子绑定仍明确提示使用后续专用流程。

上述运行时尚未接入页面或真实云端；默认启动仍不会隐式连接云端。接入需单独完成后台登录页面、显式运行配置与非生产联调授权。

本地验证：`npm run check`。2026-09-20 最近一次复核通过 5 个测试文件、33 个测试并完成生产构建。本地预览：`npm run dev`。

当前范围包括工作台、学校/班级管理、用户管理和权限管理，以及必要的权限、组织范围、版本冲突、自锁和关系上限校验。真实账号创建、短信/密码重置、云端部署和生产数据均不在本地切片内。
