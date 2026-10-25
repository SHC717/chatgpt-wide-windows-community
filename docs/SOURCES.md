# 来源与同类项目核查

核查日期：2026-10-26。此表说明项目定位，不代表已在本机安装验收第三方工具。

| 来源 | 直接证据 | 与本项目的关系 |
|---|---|---|
| [Akrabut/codex-full-width](https://github.com/Akrabut/codex-full-width) | README：macOS 启动器，正文和输入框采用 90% 可用聊天宽度，运行时 CSS，不修改官方安装文件；明确未提供经过测试的 Windows 支持。 | 本项目宽度 CSS 的上游参考，固定提交 `694d6f802d323f0b987b9c11f9ac33dd17c7a2e2`，保留 MIT 许可。Windows 管道和多窗口实现由本项目维护。 |
| [Haplois/wider-codex](https://github.com/Haplois/wider-codex) | README 及 Program.cs：Windows 启动器，寻找 Codex.exe，使用本机临时 TCP 调试端口和 CDP 应用 96rem 宽度。 | 明确的 Windows 同类方案；本项目不声称首个或唯一。其对较新 ChatGPT.exe 的实际兼容性本轮未运行验证。 |
| [OpenAI Codex #16669](https://github.com/openai/codex/issues/16669) | Windows 用户提出可调聊天宽度的功能请求，后续有 macOS 用户和上游作者讨论。 | 支持这个痛点有公开用户反馈；不等于官方承诺支持本工具，也不单独证明当前所有版本都缺少宽度设置。 |

本次公开版由维护者既有 Windows 实现提取。正文、输入框、多窗口与表格的四个核心 `.mjs` 文件保持原字节；新增社区安装包装和面向公众的说明。没有携带原私有仓库历史、设备配置、账号资料或运行数据。
