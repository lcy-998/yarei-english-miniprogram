# 跟读页 WXML 预览编译修复（2026-10-24）

微信开发者工具预览报 `Compiled subpackages/student/pronunciation/pronunciation failed`，并指出模板表达式 `unmatched parenthesis`。定位到 `pronunciation.wxml` 中“重新请求评分”按钮的 `wx:if`：外层括号缺少右括号。补齐括号，不改变按钮条件或评分规则。

修复后通过开发者工具本地预览接口对 `workspace/` 执行实际预览，返回 HTTP 200 并生成预览码。工具输出的最终代码包大小为 3,849,487 字节，主包 1,058,203 字节，学生分包 913,528 字节。本次没有上传体验版、提交审核或发布正式版本；未执行真机页面流程验收。此前笼统的 `[object Object]` 上传报错不能据此追溯为同一原因。
