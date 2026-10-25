# 海尼曼 GK 两册发布与多句映射处理（2026-10-15）

用户要求 Codex 自行补齐海尼曼资料，并坚持完整音频功能后上架。本轮新增《The Baby》《Fun at School》两册到**既有免费非生产** CloudBase；《My Family》生成多句候选，但因音频内容无法可靠确认，未上架。

| 绘本 | 原 PDF SHA-256 | 原整本音频 SHA-256 | 审核包 SHA-256 | 非生产回执 |
| --- | --- | --- | --- | --- |
| The Baby `book-2324d4e33aa2` | `2324D4E33AA2EE437F73E0099D80DEEA165BFB3B3F0F3F6A584CFE5321D7AB23` | `033930bcfd453eeb1611db1a5b244b4d9502a48cefdac5851d2a921dd9880cec` | `59CFFA368536284BF4DE08F19E823F0932D7A56C02103972515E02004BA2CE06` | `G:\英语资产\exports\cloudbase\content-e66e5ebb3f3f09d8\cloudbase-nonproduction-receipt.json` |
| Fun at School `book-2936d001b060` | `2936D001B060B69376A3DD286EC34EF5C69792EFB7F7ACDBE1D97D537938E91F` | `80f303859a41f27589bd643f9bac57d5238eba296b5d54f1cf810f994972f246` | `DE68E0955482506AFF5696D7105BCA41E63F0EC189445E559E603637B3B3A46E` | `G:\英语资产\exports\cloudbase\content-01192e00c395cb6b\cloudbase-nonproduction-receipt.json` |

两册均逐页核对 11 张原图、正文、署名和 9 个可朗读页面。原整本音频用现有非生产 Vosk 取得词语时间点，派生 9 段页级音频；原件、副本与派生 MP3 完成非零安全扫描及 EICAR 对照，哈希和版本化收据由 G 盘流水线验证。9 段分别再识别：《The Baby》8 段逐词一致，第 10 页的 “The” 被识别成 “le”，另一套唱读录音识别为完整的 “The baby has a toy”；《Fun at School》6 段逐词一致，短片的 “Fun/read/paint” 分别被识别为 “phone/re/paying”，整本录音与另一套唱读音频对其中的 “read books / paint pictures” 提供交叉证据。所有差异均在审核包保留，不冒称人工试听。

两册的资产状态均为 `publish_ready`，本地发布预检 `allowed=true`。非生产发布前核对私有 ACL、环境非付费和关闭超限计费、目标 ID 空位、两所虚构学校及配额。每册 32 个私有文件上传并 32/32 哈希读回；`The Baby` 共 1,973,145 字节，`Fun at School` 共 2,085,543 字节。两校教师与学生服务均读到完整 11 页及 9 段页级点读、跟读映射，独立 `verify` 通过；临时模型输入文件已清理。

**多句页面修正：** 原发布包把同一页的多个句子都映射到整页音频。G 盘审核与发布脚本现支持每句独立 `audioSourceRelativePath`，发布包按每句热区、起止时间和独立示范音输出；新增针对性测试验证两句不会被合并，全部 30 项资产库测试通过，已发布六册的本地发布预检仍通过。本轮没有因此更改云函数或小程序。

《My Family》候选 `book-32b3c6477d76` 已生成并扫描 9 段整页和 16 段逐句音频，登记到资产库且逐句云端识别完成。第 6 页 “sing” 在主录音和另一套唱读音频中均被模型识别为 “say”，无法据此可靠确认朗读是否与原页一致；因此未创建批准审核包，也未发布。这一候选证明新发布包结构可承载多句，但未形成云端学生页面验收证据。

截至本记录，本轮海尼曼累计非生产新增上架 **6 册**；其余 **292 册**仍为候选。原 PDF 页图保留第三方分发页脚，生产展示前需处理。微信真机试听、弱网、生产内容发布和正式小程序版本均未执行。
