# M3 原生管理剩余功能非生产部署审阅包（2026-10-06）

> **已被 0.77.0 新范围取代，不得按本文件旧 ZIP 或八页操作清单部署。**用户已取消 A-05/A-07 原生页、A-03 草稿恢复与 A-08 人工审核上架，并明确跨校公共素材和 A-02 仅管理当前学校；新的受控施工须使用后续六页审阅包重新核对源代码、函数制品、集合/索引、授权及回退。

**状态：代码与制品已准备，等待本审阅包的明确授权。** 本审阅包不表示任何新函数已部署、管理写操作已在 CloudBase 执行，或 A-01—A-08 已验收。

## 目标环境与当前云端基线

- 环境：`cloud1-d8ggzrwwedb786e41`，上海；最近只读预检返回 `NORMAL`、个人版、超限按量关闭、未付费/未计费。
- 五个原生管理函数当前均为 `Active`、`Nodejs20.19`；函数环境变量沿用当前配置。本审阅包不新增或轮换密钥，不改超时、内存或触发器。
- `native_admin_grants`、`native_admin_operations`、`native_admin_management_operations`、`native_admin_content_operations`、`teacher_media_records`、`teacher_media_operations` 六个集合已存在；本包不新增集合、索引或访问规则。
- `usr_teacher_demo_01` 的现有组织级九项管理授权及 `usr_admin_demo_01` 的 M3 前置权限已在 2026-10-06 审阅包执行记录中确认。本包不改账号、管理授权或角色。
- 最近一次只读预检摘要见本文件执行记录。预检不会读取或输出密钥值、手机号、题干、答案、提交正文或媒体私有路径。

## 本地代码完成项

- **A-01**：授权范围学校/班级数、有效账号数、任务活动数、进行中任务和待点评数量；概览支持默认近七天的日期范围。
- **A-02**：创建/编辑班级、迁移学员后停用班级、分配/调整/撤销教师班级权限。迁移与停用使用同一事务；目标班级有效、操作人两侧均有权限、版本一致时才提交。
- **A-03**：修改账号显示名、停用账号并撤销会话/角色/相关绑定、查看和解除家长绑定、恢复七天内符合条件的学生草稿。停用会递增授权版本；关系记录和学习历史保留。
- **A-04**：逐教师管理权限授予/撤销及管理操作审计查看。
- **A-05**：保存同步教材可见范围草稿、发布/停用配置、打开已发布教材的教师视角预览。
- **A-06**：分页搜索、题型与可见范围摘要、按单条版本加载题干/答案/解析只读详情、管理可见范围、单条和最多 50 条原子上/下架。
- **A-07**：名称/状态/任务类型/日期筛选；课堂任务列表显示发起教师、班级、时段、完成/待点评计数；停用继续保留任务历史；CSV 导出使用当前筛选条件。
- **A-08**：查看授权范围内的审核证据、审核/驳回、通过后单独上架、对已发布记录下架；缺扫描、转码、版权或对位证据时继续阻断审核。
- 所有写操作仍由服务端按当前教师身份、授权版本、组织/班级范围、CAS、幂等回执和审计再次验证。没有放松权限校验。

## 尚未完成且不属于本次制品

- A-03 的**新账号登录身份开户**和**管理员代发密码重置**：小程序现有认证依赖 `auth_identities` 与 CloudBase 身份提供方；现有 CloudBase Manager 用户开户能力没有接入当前受保护函数，且目前没有可用于用户验证的管理员重置流程。不能只创建本地用户文档冒充可登录账号。本包不接入新的身份凭据、短信供应商或凭据密钥。
- A-08 的真实文件扫描/转码处理器、版权人工核查以及逐题短期试听地址仍由资产处理/发布链路提供；缺真实证据时不得生成审核通过记录。
- 原生页面完整视觉稿逐页对照、横屏和真机仍未完成；当前微信模拟器可编译页面，但新增云端查询尚未部署，管理列表请求因服务端版本较旧而返回数据错误。

## 精确部署制品

以下五个独立 CommonJS 包由当前工作树通过 M3 专用构建入口生成，包内仅含 `index.js` 和 `package.json`。默认 M1/M2 构建仍排除原生管理函数。

| 函数 | ZIP | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| `native-admin-query` | `workspace/m1-cloudbase/dist/native-admin-review/remaining-work-zips/native-admin-query.zip` | 46,965 | `60DAABBD776F1A8EA964B9B72C12B2415FE755E53B3A43265D5C5AB58DC08F5A` |
| `native-admin-command` | `workspace/m1-cloudbase/dist/native-admin-review/remaining-work-zips/native-admin-command.zip` | 37,162 | `CD7779611F8A865505456887CDC4B421473836AC8420289AAC02EF2FFC147EC6` |
| `native-admin-management-command` | `workspace/m1-cloudbase/dist/native-admin-review/remaining-work-zips/native-admin-management-command.zip` | 43,184 | `F235BCDF63DD42E2EF718204B5284BEB2F02BEC397F6791F9453C288B1016FDA` |
| `native-admin-operations-command` | `workspace/m1-cloudbase/dist/native-admin-review/remaining-work-zips/native-admin-operations-command.zip` | 39,312 | `16C23A3C75F23A8823D1D51052C7427599260D09211DDF8BBEB5A717D09CD057` |
| `native-admin-media-command` | `workspace/m1-cloudbase/dist/native-admin-review/remaining-work-zips/native-admin-media-command.zip` | 39,548 | `187B1C28263DF4736EB9BA6A53C08D3D7052B6DC6878663F4B45CE823EE8C70E` |

运行配置保持：入口 `index.main`、`Nodejs20.19`、20 秒、256 MiB、无触发器、保留当前服务端环境变量。部署前须重新核验工作树 ZIP 哈希、当前 `$LATEST`、函数配置和环境仍与本表一致；任一项不同即停止并重建审阅包。

## 授权后核验范围

1. 先备份五只函数当前完整 `$LATEST` 代码与配置；按上表仅更新函数代码，不修改客户端 ACL、索引、业务数据、角色、授权、短信或其他供应商配置。
2. 对五个函数逐个核验 `$LATEST` 哈希、`Active`、运行时、超时、内存、触发器和环境变量键数量；只输出状态与键名摘要。
3. 使用现有虚构教师 `usr_teacher_demo_01` 正常登录模拟器，从 P-04 进入 A-01，验证 A-01—A-08 读取、默认日期范围、搜索/筛选、绑定/审计查看、题目单条详情和页面返回菜单。
4. 本包的自动化核验只读，不点“保存、发布、停用、撤销、解绑、批量上下架、审核通过、上架或下架”等写入按钮；这些业务写入仍需针对具体目标记录的授权。A-08 继续核验缺证据时服务端拒绝，绝不伪造扫描/转码/版权结果。
5. 若部署造成异常，使用部署前逐只备份的 `$LATEST` 代码恢复原版本，不回滚 ACL/索引，不删除既有集合、记录或审计。

## 当前只读/本地证据

- 最近运行 `workspace/` 完整检查：TypeScript、静态视觉检查通过；295 个测试文件中 292 个通过，1,238 项测试中 1,234 项通过、4 项既有学生媒体/配音测试失败（两个页面测试缺 `beginTaskMediaSession` mock，两个 S-13 作答期望与现有任务轮次存储实现不匹配）。历史网页管理端完整检查未运行到其阶段，因为根测试失败中止。
- 最近运行 `workspace/m1-cloudbase/` 完整检查：153 个测试文件、800 项测试通过。原生管理/媒体专项最近一次 7 个测试文件、31 项通过。
- 微信开发者工具当前工作树 `workspace/` 中，P-04 管理入口可见，A-01—A-08 页面都加载到 `ready`，未捕获异常数为 0。当前云端函数仍是本地代码之前的版本，A-02—A-08 查询返回数据错误；这不是页面实现验收或云端函数已更新的证据。
- 当前模拟器证据位于 `workspace/m3-acceptance/2026-10-06/admin-pages/current-build-render-check.json`；Codex 未执行本包新增的任何管理业务写操作。

**本审阅包等待用户明确批准后才可部署。**
