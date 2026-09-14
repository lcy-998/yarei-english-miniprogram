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
```

首次运行需要 Python 及 `pypdf`、`pdfplumber`、`Pillow`。页面渲染需要 Poppler 的 `pdftoppm`；音视频探测和转码建议安装 FFmpeg。

详细规则见 `docs/`。最终目标为微信小程序，但本资产库与当前 M0 小程序工程隔离，不会自动把真实教材发布到产品。全量页面、音视频和原始 PDF 应进入云存储/CDN，小程序包只使用轻量索引、资源 ID 和必要占位图。
