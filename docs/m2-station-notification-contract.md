# M2 站内通知本地合约（MSG-001 / P-05）

当前仅交付小程序站内通知。微信订阅授权、模板、发送与失败重试归 M3。

## 通知来源与唯一键

- 任务发布：已发布任务与当前有效学生任务关系；教师可见本人仍有授权的已发布任务。
- 截止提醒：截止前 24 小时内，且当前关系尚未进入待检查或完成状态；实际写入时间为通知展示时间。
- 退回、点评：提交版本对应的已发布反馈记录；反馈标识参与唯一键。
- 打卡提醒：学校当地日期 20:00 后、非休息日、当前参与人和当前班级关系，且当天服务端证据确认尚未完成；活动与本地日期参与唯一键。
- 通知 ID 由组织、当前角色、接收账号、事件类型及来源标识确定。重复查询不会产生重复通知。

任务发布、退回和点评通知在查询时从可信业务记录重建；截止与打卡提醒由服务端维护函数写入 `notification_events`，查询不自行生成定时提醒。页面不能请求创建任意通知，也不能传入接收人。家长解绑、学生转班、教师撤权或账号停用后，查询和标记已读均重新校验当前关系。已读状态写入 `notification_read_states`，由服务端管理，客户端无直连权限。`markRead` 仅接受当前仍可见的通知 ID；`markAllRead` 保存当前账号和角色的已读水位。

查询分 `all`、`task`、`feedback`、`checkin`，时间范围 7、30、90 天，单次最多 50 条。P-05 默认近 30 天、20 条，支持加载更多；角标显示当前角色的未读数，超过 99 条显示 `99+`。家长通知的深链带孩子标识，打开详情前仍由目标页面复核当前绑定。

## 可信定时维护与榜单恢复

- 通用 CloudBase 部署模板只包含 `maintenance-timer` 函数，**不自动启用定时触发器**。先验证客户端调用禁令和业务容量，再按 2026-09-27 的 M2 非生产统一授权使用 `docs/m2-maintenance-timer-trigger.example.json` 配置七段 Cron `0 * * * * * *`，每分钟触发一次；业务时间按学校的 `schoolTimeZone` 计算，不依赖 Cron 所用时区。定时器可能重复触发，通知以确定性 `_id` 去重。
- 入口同时验证平台注入的 `TRIGGER_SRC=timer` 与 Timer 事件/指定触发器名；事件字段、`Message`、客户端传入的组织或用户标识均不能构成授权。客户端伪造 Timer 事件的本地测试必须返回 `FORBIDDEN`。
- **部署前必须**在环境级云函数安全规则中为 `maintenance-timer` 设置 `"invoke": false`，并保留环境原有的 `"*"` 通配规则；本地审阅稿见 `docs/m1-cloudbase/templates/function-security-rules.example.json`。该规则阻止客户端 SDK 调用而不阻止平台定时触发。规则发布已纳入 M2 非生产统一授权，仍须实测客户端拒绝与定时触发成功。CloudBase CLI 的 `public` 字段只适用于 HTTP 云函数，不能代替此规则。
- 扫描位置保存在 `maintenance_scan_state`，每轮最多处理一个组织的 25 个任务和 25 个活动，下一分钟从已保存偏移继续；写入事件与榜单使用确定性键或事务，重复扫描不会重复创建。超过 10,000 个偏移项、并发插入导致的偏移漂移，以及 500 人活动在五分钟窗口内的实际吞吐量均未得到云端验证，不能据此宣称可上线。
- 活动结束次日学校当地 00:00—00:05 调用现有 `finalizeActivity` 固化最终榜单。若定时器错过窗口或固化失败，写入 `checkin_finalization_recovery` 待恢复记录并记错误日志；学生榜单保持“记录暂不可用”。**不使用事后当前证据重算并冒充 00:00 快照**。后续人工或专用恢复流程须先取得完整的截止时刻历史证据，才能清理待恢复状态。

官方依据：[CloudBase 函数触发器配置](https://docs.cloudbase.net/cli-v1/functions/configs)、[CloudBase 定时任务与重复触发说明](https://docs.cloudbase.net/recipes/schedule-cloud-function-cron-job)、[腾讯云定时事件结构](https://cloud.tencent.com/document/product/583/9708)、[CloudBase 云函数安全规则](https://docs.cloudbase.net/cloud-function/security-rules)、[腾讯云 `TRIGGER_SRC` 环境变量](https://cloud.tencent.com/document/product/583/30228)。

## 当前限制及联调项

- 打卡提醒通过活动服务核验当天完成状态；已完成、休息日或证据暂不可用时不写入提醒。活动证据汇聚的云端性能仍待联调。
- 内存演示模式只展示空通知状态；定时函数、CloudBase 触发器和相关集合均未部署或联调。
- 云端需新增仅服务端可读写的 `notification_read_states`、`notification_events`、`maintenance_scan_state` 和 `checkin_finalization_recovery` 集合，核对索引和查询容量；创建与规则发布已纳入 M2 非生产统一授权，真实云端证据仍未取得。
