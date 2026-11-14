---
name: sanmou-guides
description: 查询三谋武将、战法、阵容的攻略链接，纠正名称映射，或从本地 Excel 更新目录。
---

脚本：`python3 <skill目录>/scripts/guides.py <命令>`。

- 查询：`query "袁术"` 或 `query "孙坚 威震华夏"`；多个名称同时匹配。只返回标题和链接，无结果如实说明，正文由玩家打开。
- 纠错：按玩家明确反馈修改 `data/mappings.json`，目标以仓库 `web/public/game-data/database.json` 为准；歧义先问。运行 `reindex --apply` 并复查，后续更新保留修正。
- 更新：对玩家提供的本地 Excel 运行 `update <xlsx路径>` 预览，核对变化后加 `--apply`。只读首表，新名称有歧义先确认。

影本关联中的武将可能是战法来源。原表保存到本地；持久化路径使用文件名或仓库相对路径。
