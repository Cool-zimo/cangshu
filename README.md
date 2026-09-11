# 🐹 仓鼠 Cangshu

> 囤好你的每一个 GitHub 仓库 —— 一个纯前端的 GitHub 仓库管理面板。

## 在线使用

https://cool-zimo.github.io/cangshu/

## 特性

| 功能 | 说明 |
|---|---|
| **登录** | 输入 GitHub Token（支持 `ghp_` / `github_pat_`），自动验证并记忆账号 |
| **配置同步** | 管理列表存在你的私有仓库 `cangshu-config` 里，换设备也能同步 |
| **新建仓库** | 可选私有、初始化 README、一键启用 Pages |
| **仓库管理** | 改名、切换公开/私有、删除（双重确认） |
| **卡片视图** | 展示可见性、语言、大小、Star、分支、**Pages 状态**、**最新 commit hash** |
| **文件浏览** | 递归文件树，点击预览文本文件 |
| **VS Code 集成** | 右键文件 → 直接在 [vscode.dev](https://vscode.dev) 打开编辑 |
| **右键菜单** | 卡片、文件、空白处均有上下文菜单 |

## 使用要点

1. **令牌权限**：需要 `repo`（管理仓库、读写文件）。
   私有仓库的完整访问需要 `repo` 全选；若只管公开仓库，`public_repo` 也可。
2. **配置仓库**：首次登录会自动在你的账号下创建**私有**仓库 `cangshu-config`，
   里面只有一个 `cangshu.json`。删掉它只会丢失管理列表，不影响任何被管理的仓库。
3. **删除仓库是不可逆的**。若只想从面板移除，右键卡片选「从管理列表移除」。

## 安全

- 令牌只保存在浏览器 `localStorage`，**不会**上传到除 GitHub 官方 API 之外的任何服务器。
- 本应用是纯静态页面，没有后端，没有埋点，没有第三方统计。
- 建议：创建令牌时只勾选需要的权限，并在不用时 revoke。

## 本地开发

因为用了 ES Modules，需要通过 HTTP 打开（不能直接双击 `index.html`）：

```bash
python3 -m http.server 8000
# 然后访问 http://localhost:8000
```

## 文件结构

```
cangshu/
├── index.html          登录页 + 主界面
├── css/style.css       GitHub Primer 风格
└── js/
    ├── api.js          GitHub REST API 封装（含中文安全的 base64）
    ├── config.js       配置仓库读写
    ├── context-menu.js 右键菜单组件
    └── app.js          主应用（卡片 / 文件树 / 仓库 CRUD）
```

## License

MIT
