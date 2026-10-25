# 雅睿英语数字资产库

本目录把用户加入的 PDF、音频及其他教学资料加工为网站和微信小程序可消费的结构化资产。源文件保留原样，派生内容使用稳定 ID 和不可变版本。

## 快速使用

1. 将新资料放在根目录或 `inbox/`。
2. 双击或在 PowerShell 运行：

```powershell
.\scripts\run-pipeline.ps1 run
```

3. 查看：

- `RESOURCE-CATALOG.md`：人读资源表。
- `NEEDS-REVIEW.md`：需要补充或人工复核的事项。
- `library/catalog.json`：系统导入用机器目录。
- `exports/wechat/asset-index.json`：微信小程序/CloudBase 上传与回填用索引。
- `reports/last-run.json`：最近一次处理结果。
- `docs/REVIEWED-CONTENT-PACKAGE.md`：复核记录、状态提升和发布包字段说明。

## 常用模式

```powershell
# 增量处理所有新增或变更文件
.\scripts\run-pipeline.ps1 run

# 对指定文件重新加工，并提取全部页面坐标
.\scripts\run-pipeline.ps1 run -OnlyFile "人教版英语·电子课本·四上.pdf" -Coordinates all -Refresh

# 生成全部网页页面图；数据量可能很大
.\scripts\run-pipeline.ps1 run -OnlyFile "人教版英语·电子课本·四上.pdf" -Coordinates all -Render all -Refresh

# 对扫描型 PDF 生成全书中英文 OCR、坐标和页面图
.\scripts\run-pipeline.ps1 run -OnlyFile "扫描教材.pdf" -Coordinates all -Render all -Ocr all -Refresh

# 只刷新已登记 MP3 的时长与编码，不重做教材页图
.\scripts\run-pipeline.ps1 run -OnlyFile "*.mp3" -Refresh

# 针对坐标越界或缺坐标页生成替代 OCR 候选，不覆盖原结果
python .\scripts\build-coordinate-candidates.py --root . --limit 30

# 从已有逐页文本/音频生成待人工复核的绘本内容草稿
python .\scripts\build-review-candidate.py --root . --resource-id book-sbc-en-0008
```

## CloudBase 发布包（本地预演）

阅读书、词包或题目经不可覆盖的 `review/approved-content-vN.json` 人工复核并由流水线校验为 `publish_ready` 后，先运行不访问云端的预演。该命令检查内容、版本、媒体引用与待上传文件；未通过时明确阻断：

```powershell
.\scripts\build-cloudbase-publish-bundle.ps1 plan -ResourceId "book-pep-4a" -OrganizationId "org_qihang_demo"
```

预演通过后生成版本化草稿包。包内包含哈希化云存储路径、待回填 fileID 的页图和已复核音频清单（适用时），以及符合 `learning_resources` 草稿字段契约的数据库模板；生成过程不会读取凭据、登录或写入 CloudBase：

```powershell
.\scripts\build-cloudbase-publish-bundle.ps1 bundle -ResourceId "book-pep-4a" -OrganizationId "org_qihang_demo"
```

后续后台导入器必须先上传对象并回填引用；班级和学员授权由服务端从当前关系计算，验证 `content-query` 与阅读进度均可读取后才能按项目流程发布。独立音视频的后台资产库导入、转码、审核功能仍属 M3，不由此阅读书草稿包替代；教师端只引用已审核上架的资产。

首次运行需要 Python 及 `pypdf`、`pdfplumber`、`Pillow`、`mutagen`。页面渲染需要 Poppler 的 `pdftoppm`；MP3 时长可由 `mutagen` 探测，视频探测和转码仍建议安装 FFmpeg。

详细规则见 `docs/`。最终目标为微信小程序，但本资产库与主项目当前里程碑隔离，不会自动把真实教材发布到产品。全量页面、音视频和原始 PDF 应进入云存储/CDN，小程序包只使用轻量索引、资源 ID 和必要占位图。
