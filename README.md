# ChatGPT Wide Windows

**让 Windows 版 ChatGPT / Codex 的正文与输入框用上约 90% 的可用聊天宽度。**

![默认窄栏与90%宽屏的布局对比](media/hero.png)

大屏幕两侧空着，长回答、表格和代码仍挤在中间？这个小工具通过独立的「ChatGPT 宽屏（社区版）」入口启动你已安装的官方客户端，在内存中调整聊天布局。字号和侧栏保持原样。

[English](README.en.md) · [安装](#安装) · [恢复默认](#恢复默认) · [工作原理与安全说明](SECURITY.md) · [来源与同类项目](docs/SOURCES.md) · [宣传图](media/douyin/)

## 能做什么

- **正文和输入框一起加宽**：采用可用聊天区域的 90%，两侧保留适度留白；打开侧栏或面板后，参照的是剩余聊天区域。
- **新窗口继承选择**：同一客户端实例中，「在新窗口打开」的聊天和重新加载的聊天窗口继续采用当前会话的宽度选择。
- **处理表格越界**：兼容已验证客户端中的旧 Markdown 表格及较新的 TableFrame / 滚动容器结构；超宽表格仍可在自己的区域内横向滚动。
- **随时切回默认**：提供恢复默认、重新加宽以及恢复官方启动方式三个入口。
- **保留官方应用**：不改 WindowsApps、app.asar、代码签名、账号或聊天记录；运行时样式通过启动时继承的管道应用，不创建 TCP 调试端口。

这是非 OpenAI 官方工具。它只调整布局，不增加模型能力或额度，也不改变字体大小。

## 适用范围

- Windows x64，安装了 **OpenAI 签名**的 Microsoft Store `OpenAI.Codex` 包，程序入口为 `app/ChatGPT.exe`。
- 已有 **Node.js 22 或更新版本**、**PowerShell 7**，以及 Windows 的 .NET Framework C# 编译器。当前验证环境为 Node.js 24.19.0、PowerShell 7.6.5。安装脚本会先检查，不自动安装依赖。
- 普通 Windows 用户权限；请在独立打开的 PowerShell 7 窗口运行，不要选择「以管理员身份运行」。

不在本次验证范围内：旧 `Codex.exe` 入口、ChatGPT Classic、浏览器网页版、第三方封装客户端、Windows ARM64、macOS、Linux。客户端内部页面结构更新可能使样式失效，已验证版本和证据范围见 [验证记录](docs/VALIDATION.md)。

## 安装

1. 下载本仓库 ZIP 并解压，或克隆到本机普通非同步目录。不要放入 OneDrive、百度同步盘或官方应用安装目录。
2. 打开 **PowerShell 7**，进入仓库目录。准备一个已存在、非同步、用于回退的备份文件夹，替换下面的示例路径。
3. 先预检，再安装：

```powershell
pwsh -NoProfile -File .\Install-Wide.ps1 -BackupRoot 'D:\Backups\ChatGPTWideWindows' -PlanOnly
pwsh -NoProfile -File .\Install-Wide.ps1 -BackupRoot 'D:\Backups\ChatGPTWideWindows'
```

`-PlanOnly` 不写入文件。安装会本地编译隐藏启动器，部署到 `%LOCALAPPDATA%/ChatGPTWideWindows`，新增开始菜单 **ChatGPT 宽屏（社区版）** 和三个恢复入口。官方原有的开始菜单项目与固定项不改动。

Node 或 PowerShell 不在 PATH 时，显式指定已有程序：

```powershell
pwsh -NoProfile -File .\Install-Wide.ps1 `
  -BackupRoot 'D:\Backups\ChatGPTWideWindows' `
  -NodePath 'C:\Path\To\node.exe' `
  -PowerShellPath 'C:\Program Files\PowerShell\7\pwsh.exe'
```

安装不会关闭或重启客户端。方便时请自己**完全退出**官方客户端，再从 **ChatGPT 宽屏（社区版）** 打开。仅关闭一个聊天窗口可能没有退出整个应用。

若原客户端已从普通入口运行，再点宽屏入口只会激活原窗口。没有启动管道的现有实例无法在本次会话中补上宽屏；工具不会强行结束它。

已有社区安装或同名快捷方式时，安装器停止并保留原内容，避免覆盖未知版本。请先记录来源、比较文件及备份，再决定增量更新；本版没有自动升级器。

## 恢复默认

安装目录 `%LOCALAPPDATA%/ChatGPTWideWindows` 中有：

| 入口 | 行为 |
|---|---|
| `恢复默认宽度.lnk` | 移除当前受管会话所有聊天窗口中的本工具样式；之后新窗口沿用默认宽度。 |
| `恢复90%宽屏.lnk` | 在仍受管的同一次会话中重新加宽，新增窗口继续继承。 |
| `恢复官方启动方式.lnk` | 经确认后，将社区快捷方式恢复为直接启动官方应用，并取消以后的默认加宽；也尝试恢复当前会话宽度。 |

「恢复默认宽度」只改变当前会话，下次从启用状态的社区入口冷启动仍会加宽。「恢复官方启动方式」会永久停用此安装的默认加宽；「恢复90%宽屏」只操作仍连接的当前会话，不会重新启用已停用安装的下次启动。

如当前控制连接失效，可在方便时完全退出，再从官方入口打开。恢复操作不删除账号、聊天或官方应用。若快捷方式被其他程序改写，恢复脚本停止，保留双方内容供检查。

## 工作原理

隐藏的 C# 启动器调用本机 Node 控制器，使用 `--remote-debugging-pipe` 启动已核验的官方程序。控制器通过继承的匿名管道发现目标聊天页面，应用一段可撤销 CSS；逐窗口处理新增、重载、关闭和统一恢复。

只接受 `app://-/index.html` 且具有 Electron 主窗口标识的页面。原生正文与输入框宽度都已达到至少 90% 时，本次启动跳过覆盖。Pages 文档的全宽选项与聊天宽度分开判断。

本项目不发送遥测，也不需要 API key。诊断状态含进程号、布局数值、会话控制标识和错误类别，不记录聊天文字。继承管道仍是调试控制通道，不能防御已控制当前 Windows 用户的恶意程序，详见 [SECURITY.md](SECURITY.md)。

## 开发与检查

没有第三方 Node 包依赖，不需要 `npm install`：

```powershell
node --test test/prototype.test.mjs test/controller.test.mjs test/daily.test.mjs
```

安装、快捷方式恢复和真实路径检查可在新的临时目录中验证，步骤见 [开发验证](docs/VALIDATION.md)。测试不需要登录新账号，不应关闭或重启正在使用的客户端。安装包样式只读兼容检查使用本机已有的 Playwright 和无登录临时浏览器，不会自动下载依赖。

## 来源、同类项目与许可

宽度 CSS 参考 [Akrabut/codex-full-width](https://github.com/Akrabut/codex-full-width) 的 MIT 实现，固定来源提交 `694d6f802d323f0b987b9c11f9ac33dd17c7a2e2`，原许可保存在 [UPSTREAM-LICENSE.txt](UPSTREAM-LICENSE.txt)。Windows 管道启动、控制器、多窗口管理、恢复和社区安装入口由本项目维护。

GitHub 已有 [Haplois/wider-codex](https://github.com/Haplois/wider-codex) 等 Windows 加宽实现。本项目采用 90% 相对宽度、继承管道、多窗口管理和可恢复入口；不以「首个」「唯一」为定位。同类项目本轮只做了源码及说明核查，没有本机安装验收。

源码按 [MIT License](LICENSE) 开放。宣传图是 AI 生成的布局示意，不是官方客户端实拍；[图像来源说明](docs/IMAGE-PROVENANCE.md)记录提示词、用途和文件校验信息。
