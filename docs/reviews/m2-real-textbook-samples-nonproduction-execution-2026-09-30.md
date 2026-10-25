# 同步学教材真实测试节选执行记录（2026-09-30）

## 实际操作

- 在既有非生产 CloudBase 环境执行独立预检：个人版、状态正常、无已产生费用、未开启超额计费；存储 ACL 仍仅创建者和管理员可读写。目标前缀、两条资源 ID 和审计 ID 均为空。两个虚构班级的授权和有效成员分别为 36、32 人，M2 基础种子成功。
- 保留 F 盘两个原始 PDF；对来源 PDF 和选定页图做本地 SHA-256 核对。仅上传三年级第 1—13 页、四年级第 1—17 页的原页图及缩略图，共 60 个文件、10,832,600 字节。上传后 60/60 个文件从私有云存储读回，与 `manifest.json` 哈希一致。
- 在同一数据库事务新增 `res_m2_real_pep3a_unit1_20260930`、`res_m2_real_pep4a_unit1_20260930` 两条已发布但明确标“测试节选”的 `learning_resources`，以及 `audit_m2_real_textbooks_20260930` 审计记录。两条资源含真实页图、封面/Unit 1 阅读章节、T-14 课次目录，以及当前班级的阅读进度授权名单和页码索引；没有修改旧 M1/M2 数据或创建任务、班级教材配置。
- 本地提供 `workspace/m2-acceptance/2026-09-30-real-textbooks/review-bundle.zip`，其中 60 个媒体文件的哈希再次核对通过，压缩包约 9.4 MB；源 PDF 保留在素材库原位。

## 已验证结果

- 独立运行 `node tools/run-m2-real-textbook-setup.mjs verify` 退出码 0，输出 `storageHash=60/60;teacherCatalog=2;studentCatalog=2;crossClass=denied;progressAccess=ready;pageSigned=60`。
- 教师服务端 T-14 目录查到两册，目标班级查询各自正确；三年级、四年级学生的 S-03 目录只含本班节选，S-04 详情页数分别为 13 和 17，阅读进度服务能读取授权资源。60 张私有图片均可签发短期 HTTPS 地址。
- 后端静态类型检查通过；上传脚本和验收包脚本均通过语法/文件哈希检查。
- 使用 2026-09-30 最新虚构学生、教师密码进行了**已部署云函数**的独立只读联调，未轮换密码：学生经平台密码认证、`auth-session.bootstrap/selectRole` 后，`content-query.listStudentCatalog` 返回三年级节选且不返回跨班四年级节选，`getReadingResource` 返回 13 张 HTTPS 页图和 13 张缩略图，`learning-progress-query.getReadingProgress` 成功；教师同样完成认证后，`teacher-textbook-query.listTextbooks` 返回两册，分别打开两册 `getTextbook` 预览，并经实际 `content-query.getReadingResource` 签发全部 30 张高清页图及 30 张缩略图。脚本只输出通过摘要，不输出密码、会话令牌或临时图片地址。

## 人工页面状态和边界

微信开发者工具中使用此前交付的 9 月 28 日旧密码返回认证失败；检查其他 M2 联调记录后确认 9 月 30 日已轮换演示密码。用 9 月 30 日新密码登录曾到达学生首页，但进入 S-03 时模拟器随后又回到登录页；在并行联调中的共享模拟器尚未取得稳定的 T-14/S-03 页面截图，因此**本批不报告已登录页面点验通过**。这不影响云端素材上传和独立服务端验证的通过结论，人工点验仍需按本包 README 的入口完成。

本批资源只作非生产 Unit 1 页图/目录测试。来源库的教材仍是 `needs_review`，自动 OCR、词坐标、教材元数据、出版社音轨和页面/题目绑定没有因此变为已审核内容；没有执行生产发布、付费开通或真实个人信息处理。
