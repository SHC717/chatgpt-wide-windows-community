# 验证记录与复现

验证日期：2026-10-26，Windows x64，Node.js 24.19.0、PowerShell 7.6.5。官方安装包为 `OpenAI.Codex 26.1021.3705.0`，签名核验通过。软件层检查、离线布局验证与用户真实界面反馈分别记录，不能相互替代。

## 本轮实际结果

| 检查 | 结果 |
|---|---|
| Node 核心检查 | 22 项通过，0 失败、0 跳过；包括多窗口创建、重载、关闭、统一恢复、后台动画帧暂停、目标筛选和真实 Windows 子进程管道。 |
| 隔离快捷方式与 GUI | 7 项通过：安装切换、外部改写保护、精确恢复、重复恢复、失败回退、GUI 子系统、只读 GUI 自检。 |
| 社区安装包装 | 全新隔离安装、已有安装拒绝覆盖、真实数据句柄、同步目录拒绝共 4 项通过。只使用测试进程的临时 AppData/菜单，不改正式开始菜单。 |
| 离线表格几何 | 18 个场景、144 项检查通过，0 失败；读取上述官方包的样式，使用无登录临时浏览器与合成内容，阻止网络请求。 |
| 源码与隐私 | 四个核心 `.mjs` 与提取来源逐字节一致；公开文件未发现私人绝对路径、设备名或凭据值。 |

本轮没有关闭、重启或重新部署正在使用的官方客户端，没有把测试安装记为新设备的真实界面验收。

## 可复现检查

Node 核心检查不需要安装第三方依赖：

```powershell
node --test test/prototype.test.mjs test/controller.test.mjs test/daily.test.mjs
```

`test/shortcut.test.ps1` 接受已构建的隔离 staging 和一个尚不存在的非同步测试目录，验证快捷方式切换、外部修改拒绝、精确恢复、重复恢复、失败回退、GUI 子系统与只读 GUI 自检。它不应以正式运行目录或真实快捷方式作为测试目标。

社区安装测试会在新测试目录中创建临时菜单、运行文件和回退基线；包含上述 7 项快捷方式检查：

```powershell
pwsh -NoProfile -File test/community-install.test.ps1 -TestRoot '<new local temporary directory>'
```

它仍需要已安装的受支持官方客户端和既有依赖，但只执行 GUI `--probe`，不启动或重启客户端。测试目录必须尚不存在。

`test/table-layout.browser.mjs` 使用本机已有的 Playwright 和无登录临时浏览器，按层叠顺序只读载入官方安装包中的 CSS，以合成表格检查不同窗口宽度、缩放、三种表格结构的边界与横向可达性：

```powershell
node test/table-layout.browser.mjs `
  --playwright-module '<existing Playwright module>' `
  --browser-exe '<existing browser executable>' `
  --app-asar '<verified official resources/app.asar>' `
  --evidence-root '<new local temporary directory>'
```

它阻止网络请求，不使用个人浏览器资料、不读取聊天、不启动官方客户端，也不自动下载浏览器或依赖。

## 验收边界

既有 Windows 实现中，维护者曾确认主窗口和应用内新窗口宽屏生效；另一台设备的用户确认过新版表格首列修复。这些是当时、对应设备与版本的反馈。

本次社区包装在隔离目录构建和验证，不重新安装到维护者的正式环境，也不关闭当前客户端。其他 Windows 设备、ARM64 和未来客户端版本均需独立验证；不能据本轮测试写成全面兼容。
