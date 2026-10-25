import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alive, atomicJson, readJson, inspect, sleep } from './controller.mjs';
import { randomUUID } from 'node:crypto';
const exec = promisify(execFile);

export function chooseLaunchAction({ enabled, running, managed }) {
  if (running) return managed ? 'activate-managed' : 'activate-unmanaged';
  return enabled ? 'start-wide' : 'start-official';
}
function launchDetached(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { detached: true, windowsHide: true, stdio: 'ignore' });
    child.once('error', () => reject(new Error('PROCESS_START_FAILED')));
    child.once('spawn', () => { child.unref(); resolve(child.pid); });
  });
}
async function managedSession(config) {
  const state = await readJson(join(config.runtimeRoot, 'state', 'status.json'));
  if (state && ['active', 'restored', 'native'].includes(state.mode) && alive(state.controllerPid)) return { state, legacy: false };
  const legacy = config.legacyStatePath ? await readJson(config.legacyStatePath) : null;
  if (legacy?.mode === 'active' && alive(legacy.controllerPid)) return { state: legacy, legacy: true };
  return null;
}
async function changeWidth(config, action) {
  const managed = await managedSession(config);
  if (!managed) return { ok: true, notice: '当前没有可连接的宽屏控制器。若宽屏仍在，请完全退出客户端后从普通官方入口重新打开。', currentRestored: false };
  if (managed.legacy && action === 'apply') return { ok: true, notice: '当前仍是临时版会话。下次完全退出后，从开始菜单的 ChatGPT 启动即可使用日常版。' };
  const state = managed.state, requestId = randomUUID();
  const requestPath = managed.legacy ? join(dirname(config.legacyStatePath), 'restore-request.json') : join(config.runtimeRoot, 'state', 'request.json');
  await atomicJson(requestPath, managed.legacy ? { requestId, controllerPid: state.controllerPid } : { requestId, sessionKey: state.sessionKey, action });
  const statusPath = managed.legacy ? config.legacyStatePath : join(config.runtimeRoot, 'state', 'status.json');
  for (let i = 0; i < 120; i++) {
    const result = await readJson(statusPath);
    if (result?.requestId === requestId) {
      // An already-running pre-fix controller remains single-window until the
      // user exits normally. Do not describe its acknowledgement as all-window.
      const multiWindow = result.featureRevision === 'multi-window.1';
      return { ok: true, currentRestored: result.mode === 'restored', notice: multiWindow ?
        (action === 'restore' ? '当前会话的所有聊天窗口已恢复默认宽度，新窗口会继承该选择。下次启动仍会默认加宽；如要永久取消，请使用“恢复官方启动方式”。' : '当前会话的所有聊天窗口已恢复90%宽屏，新窗口会继承该选择。') :
        (action === 'restore' ? '当前窗口已恢复默认宽度。多窗口继承修复将在正常完全退出、从“ChatGPT 宽屏”重新打开后生效。' : '当前窗口已恢复90%宽屏。多窗口继承修复将在正常完全退出、从“ChatGPT 宽屏”重新打开后生效。') };
    }
    await sleep(100);
  }
  return { ok: false, notice: '尚未确认所有聊天窗口均已完成宽度切换。请保留当前客户端，可稍后重试，或在方便时完全退出后重新打开。' };
}
export async function dispatch(config, command) {
  const info = await inspect(config);
  if (command === 'probe') return { ok: true, official: info.official, registeredPackage: info.registeredPackage, running: info.running.length, pipeOnly: true, enabled: config.enabled };
  if (command === 'restore' || command === 'apply') return changeWidth(config, command);
  if (command === 'disable') {
    const restored = await changeWidth(config, 'restore');
    const { stdout } = await exec(config.powershellExe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', join(config.runtimeRoot, 'restore-shortcut.ps1'), '-ConfigPath', join(config.runtimeRoot, 'runtime.local.json'), '-CurrentOfficialExe', info.appExe], { windowsHide: true, timeout: 15000, encoding: 'utf8', maxBuffer: 65536 });
    const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    if (!result.restored && !result.alreadyOfficial) throw new Error('SHORTCUT_RESTORE_NOT_CONFIRMED');
    config.enabled = false;
    await atomicJson(join(config.runtimeRoot, 'runtime.local.json'), config);
    return { ok: true, notice: '已恢复官方启动方式。今后从开始菜单启动将采用原生布局。' + (restored.currentRestored ? '当前窗口也已恢复默认宽度。' : '当前窗口若仍是宽屏，请在方便时完全退出后重新打开。') };
  }
  if (command !== 'launch') throw new Error('UNKNOWN_COMMAND');
  const managed = await managedSession(config);
  const decision = chooseLaunchAction({ enabled: config.enabled, running: info.running.length > 0, managed: Boolean(managed && info.running.some(item => item.pid === managed.state.appPid)) });
  if (decision !== 'start-wide') {
    const executable = info.running[0]?.executablePath ?? info.appExe;
    await launchDetached(executable, []);
    return { ok: true, decision, notice: decision === 'activate-unmanaged' && config.enabled ? '客户端已经打开，本次回到现有窗口。下次完全退出后，从开始菜单再次启动 ChatGPT，就会自动应用90%宽屏。' : null };
  }
  await mkdir(join(config.runtimeRoot, 'state'), { recursive: true });
  const pid = await launchDetached(config.nodeExe, [join(config.runtimeRoot, 'controller.mjs'), join(config.runtimeRoot, 'runtime.local.json')]);
  for (let i = 0; i < 350; i++) {
    const state = await readJson(join(config.runtimeRoot, 'state', 'status.json'));
    if (state?.controllerPid === pid && ['active', 'native'].includes(state.mode)) return { ok: true, decision, nativeSufficient: state.mode === 'native' };
    if (state?.controllerPid === pid && ['failed', 'restoration-unconfirmed'].includes(state.mode)) return { ok: false, notice: '客户端已尝试启动，但未能完成宽屏连接。没有切换调试端口。可在方便时退出后重试，或使用“恢复官方启动方式”。', code: state.error };
    if (!alive(pid)) break;
    await sleep(100);
  }
  return { ok: false, notice: '宽屏启动未得到确认。请保留当前客户端；可稍后检查状态或恢复官方启动方式。' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let result;
  try {
    const config = await readJson(process.argv[2]);
    result = await dispatch(config, process.argv[3] ?? 'launch');
  } catch (error) { result = { ok: false, code: /^[A-Z_]+$/.test(error.message) ? error.message : 'LOCAL_CHECK_FAILED', notice: '启动检查未通过，当前客户端没有被关闭。可使用“恢复官方启动方式”，或检查本机状态。' }; }
  process.stdout.write(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
