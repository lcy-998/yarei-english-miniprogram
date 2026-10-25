# M3 公共习题受控导入（非生产）

此入口只处理明确复核为可跨学校教学使用的一题一源包。旧题不会被扫描或自动复制。真实资产缺少已批准题目时，预检应停止，不得用虚构审批文件放行真实内容。

## 输入包与预检

运行：node tools/run-m3-public-question-distribution.mjs plan <package.json>

输入 JSON 包含 VerifiedPublicQuestionInput 的题目、来源、版本和审核字段，另加 assetRoot 和 evidence。evidence 下分别提供 manifestPath、approvedContentPath、sourcePath、copyrightEvidencePath，四个路径均须相对 assetRoot 且解析后仍位于该目录内。

预检逐字节计算哈希，核对 manifest 的 publish_ready、源文件哈希、已批准题目与版本、版权状态及跨校教学许可。版权复核 JSON 须有相同 resourceId、sourceSha256、decision 为 approved、scope 为 all_schools_teaching。输入 organizationId 为审阅包指定的现有学校；apply 会核实它仍处于启用状态，不创建虚拟学校。reviewId 为 review_ 加已批准内容文件 SHA-256 前 32 位，copyrightEvidenceId 为 copyright_ 加版权复核文件 SHA-256 前 32 位。manifestSha256、copyrightEvidenceSha256 和 sourceSha256 均为实际文件哈希。plan 仅做本地预检，不连接云端。

## 云端审阅与执行

apply、sync-org 和回退命令均要求另一份明确批准的非生产审阅 JSON。共同字段：authorizationScope 为 m3_public_question_nonproduction、approved 为 true、经核对的 environmentId 和未到期 expiresAt。执行前程序核对唯一环境、个人版、关闭超限按量、未付费状态与临时凭据；不修改凭据或函数。

- apply <package.json> <review.json>：审阅 operation 为 import_public_question，并写明 inputSha256、sourceId、sourceOrganizationId、完整 expectedOrganizationIds、maxOrganizationCount，以及 rollback.action 为 offline_source_preserve_history、rollback.sourceId 与源一致。执行前再次核对来源学校和学校集合；源和每校投影使用确定性 ID 幂等写入并留审计。
- sync-org <organizationId> <review.json>：仅对新建或重新启用的学校补投影。审阅 operation 为 sync_public_question_to_organization、organizationId 一致、完整 expectedSourceIds 和 maxProjectionCount，并预先确认这些来源的跨校许可；rollback.action 为 offline_projection_preserve_history，rollback.organizationId 一致。
- offline-source <sourceId> <review.json>：审阅 operation 为 offline_public_question_source、sourceId、实际来源学校 organizationId、当前 expectedVersion、源与清单哈希、1—200 字 reason 和唯一 operationId。源下架后全部跨校新引用立即受阻，历史任务快照保留。
- offline-projection <projectionId> <review.json>：审阅 operation 为 offline_public_question_projection、来源 sourceId、目标 organizationId、当前 expectedVersion、源与清单哈希、原因及操作号。projectionId 须与来源和学校推导值一致。仅停止目标学校新引用。

回退是受审阅约束的软下架，不删除素材、任务快照或审计。并发版本变化、来源证据不符、学校集合变化或费用预检不符均停止。没有 M3 云端施工授权时，只运行 plan。
