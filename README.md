# Fleeting

轻量桌面备忘录，基于 Electron + Markdown，交互参考 [memos](https://github.com/usememos/memos)。

## 特性

- **Markdown 存储** — 按月生成 `YYYY-MM.md` 文件，数据完全本地化、可读
- **Markdown 渲染** — 支持标题、代码块、列表、引用等格式
- **标签系统** — 内容中使用 `#标签名` 打标签，支持多标签（空格分隔）
- **标签自动补全** — 输入 `#` 自动弹出已有标签，↑↓ 选择，Enter/Tab 补全
- **全文搜索** — 跨月份搜索内容或标签，支持混合查询（如 `#工作 项目`）
- **侧边栏导航** — 按月份和标签分类浏览，点击即可过滤

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式运行
make run

# 打包并安装到 /Applications
make install
```

## 数据存储

所有数据保存在 `~/Documents/fleeting/`：

```
~/Documents/fleeting/
├── 2026-02.md      # 每月一个 Markdown 文件
├── 2026-01.md
└── config.yaml     # 标签列表缓存
```

每条 memo 格式：

```markdown
## 2026-02-24 10:30:25
这是一条备忘，支持 **Markdown** 和 #标签
---
```

## 使用说明

| 操作 | 方式 |
|------|------|
| 发送 memo | `Ctrl+Enter` 或点击「发送」按钮 |
| 插入标签 | 输入 `#` 后从下拉框选择或继续输入 |
| 搜索内容 | 顶部搜索框输入关键词 |
| 搜索标签 | 搜索框输入 `#标签名`，或点击左侧标签列表 |
| 取消过滤 | 点击已选中标签，或清除搜索框 |
| 删除 memo | 悬浮卡片，点击右上角 🗑 图标 |
| 打开文件目录 | 侧边栏底部「📂 打开存储目录」 |

## 技术栈

- [Electron](https://www.electronjs.org/) — 桌面应用框架
- [marked](https://marked.js.org/) — Markdown 渲染
- [js-yaml](https://github.com/nodeca/js-yaml) — YAML 配置读写
- [electron-builder](https://www.electron.build/) — 打包构建
