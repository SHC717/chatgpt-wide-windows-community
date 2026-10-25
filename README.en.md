# ChatGPT Wide Windows

**Use roughly 90% of the available chat pane for conversations and the composer in the official Windows ChatGPT / Codex desktop app.**

![Narrow versus wide layout schematic](media/hero.png)

[中文完整说明](README.md) · [Security](SECURITY.md) · [Sources](docs/SOURCES.md)

This unofficial launcher applies reversible CSS in memory. It keeps the original font size and sidebar, manages newly opened chat windows, and provides restore controls. The official app files, signature, account and chat history are left intact.

## Requirements and installation

- Windows x64; the OpenAI-signed Microsoft Store `OpenAI.Codex` package with `app/ChatGPT.exe`.
- Existing Node.js 22+, PowerShell 7, and the Windows .NET Framework C# compiler. No npm dependencies. The installer does not download runtimes.
- Run as your ordinary Windows user in an independently opened PowerShell 7 window.

Extract this repository outside cloud-synchronized folders. Choose an existing local backup directory and run:

```powershell
pwsh -NoProfile -File .\Install-Wide.ps1 -BackupRoot 'D:\Backups\ChatGPTWideWindows' -PlanOnly
pwsh -NoProfile -File .\Install-Wide.ps1 -BackupRoot 'D:\Backups\ChatGPTWideWindows'
```

The preflight writes nothing. Installation compiles a hidden launcher locally, adds a separate Start Menu entry named **ChatGPT 宽屏（社区版）**, and leaves the official entry untouched. The runtime lives in `%LOCALAPPDATA%/ChatGPTWideWindows`. It never closes or restarts a running client. When convenient, fully quit the client yourself and launch the new entry.

An existing runtime or shortcut causes installation to stop rather than overwrite it. No automatic updater or prebuilt installer EXE is included.

## Restore

The runtime directory contains shortcuts to restore the current session's default width, reapply the 90% width, and disable future wide launches by restoring the community shortcut's official launch target. The last action asks for confirmation. Reapplying width within a managed session does not re-enable future wide launches after permanent disable.

Only clients launched with the inherited debugging pipe can be managed. Starting the utility while an ordinary instance is already running activates that instance; it does not retrofit a debugging connection or force a restart.

## Implementation and limits

The C# launcher invokes a Node controller that starts the verified official app with `--remote-debugging-pipe`. It exposes no TCP debugging listener. It tracks chat targets, injects a scoped stylesheet and removes its own stylesheet on request. The 90% refers to the available conversation area, not the monitor's full width. Tables may retain their own horizontal scrolling.

This depends on unsupported internal DOM/CSS structures and can break after an app update. Browser extensions, ChatGPT Classic, older `Codex.exe` builds, ARM64, macOS and Linux are outside this release's validation scope. See [validation boundaries](docs/VALIDATION.md).

## Attribution and license

Width CSS is adapted from [Akrabut/codex-full-width](https://github.com/Akrabut/codex-full-width), pinned to `694d6f802d323f0b987b9c11f9ac33dd17c7a2e2`, under MIT; its original notice is preserved in [UPSTREAM-LICENSE.txt](UPSTREAM-LICENSE.txt). Windows launch, pipe transport, multi-window control, recovery and community packaging are maintained here.

Other Windows projects already exist, including [Haplois/wider-codex](https://github.com/Haplois/wider-codex). This project makes no first-or-only claim. Code is [MIT licensed](LICENSE). Promotional images are AI-generated layout illustrations, not actual app screenshots; see [image provenance](docs/IMAGE-PROVENANCE.md).
