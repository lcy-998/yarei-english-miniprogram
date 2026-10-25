# 两册海尼曼 GK 绘本非生产发布（2026-10-15）

用户要求 Codex 自行补齐并坚持完整音频功能。本记录补充《Packing My Bag》和《At School》；《At the Market》《On the Way to School》见各自执行记录。目标仍是既有免费、超额计费关闭的非生产 CloudBase `cloud1-d8ggzrwwedb786e41`。

| 书籍与 ID | 原 PDF SHA-256 | 原整本音频 SHA-256 | 审核包 SHA-256 | 云端回执 |
| --- | --- | --- | --- | --- |
| Packing My Bag `book-f47b586ff90e` | `F47B586FF90EF7D64467972E1351E3F4789846539F7AA24A6E236F4C2543555A` | `3d3cdaa5fdb139cc7eb16a816f54719fecb7995ff7ceb7bb45adde0ad848e1b0` | `D89276D1173BB1D88FD6BE811F047A0DD4380C8364CC5D503C201F2FDE4C0D1E` | `G:\英语资产\exports\cloudbase\content-d6f3e1b2219771de\cloudbase-nonproduction-receipt.json` |
| At School `book-04f1c315af39` | `04F1C315AF390A88BE2F116C6A6A0227E7546D5147112FF190F842D9C2E074BD` | `150d8b55ed40262db53a490c2dd43721feedfc94bc62ac6aeb373de1da4060b7` | `A0D1F9C8D4ADF2866E1D8C471B05D22ACDFEF032EAF6166295CB8DA15EBD4E0D` | `G:\英语资产\exports\cloudbase\content-3145b165ff5ad616\cloudbase-nonproduction-receipt.json` |

两册均逐页核对了 11 张原页图、署名、书名与 8 句正文。原整本录音经既有非生产云端 Vosk 识别，按页图正文顺序逐词一致；每册从原声切出 9 段 MP3，原声和派生文件完成非零安全扫描、EICAR 对照与哈希核验。页级片段再分别送云端识别：《At School》9/9 段逐词一致；《Packing My Bag》8/9 段逐词一致，书名短片把 “bag” 识别为 “back”，但整本原声识别为 “bag”，与封面、标题页和最后一页一致。差异及模型置信度保存在不可覆盖的 Codex 审核包中，没有写成人工试听结果。

资产流水线对两册及各自 9 段派生音频检查成功，均标 `publish_ready`；本地 CloudBase 发布 `plan` 均返回 `allowed=true`。逐册预检非生产环境、私有存储、配额、目标空位与两所虚构学校后，分别上传 32 个文件：`Packing My Bag` 共 1,830,021 字节，`At School` 共 2,757,966 字节。两批 32/32 云端文件下载哈希一致，教师与学生服务均读到完整 11 页和 9 段点读/跟读映射；独立 `verify` 再次通过。临时模型输入文件在每次调用后精确删除。

截至本记录，本轮新增海尼曼绘本非生产上架累计 **4 册**，另外 294 册仍是候选。原 PDF 页图带第三方分发页脚，生产展示前需处理；微信真机试听、弱网与生产内容发布未执行。没有更改正式小程序版本、真实账号或业务云函数。
