# 新资料入口

后续新增的 PDF、MP3、AAC、M4A、WAV、MP4、字幕、文本、JSON、CSV、XLSX 或 DOCX 可放入本目录，也可以继续放在资产库根目录。

建议使用子目录保留来源关系，例如：

```text
inbox/
└─ pep-4a/
   ├─ unit-01-listening.mp3
   ├─ unit-01-transcript.docx
   └─ unit-01-answers.xlsx
```

添加后运行 `..\scripts\run-pipeline.ps1 run`。脚本不会移动或删除这里的文件。
