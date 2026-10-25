import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PipeClient, selectMainTargets } from './pipe-client.mjs';
import { expressionFor } from './width-style.mjs';

const exec = promisify(execFile);
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function alive(pid) { try { if (!Number.isInteger(pid) || pid <= 0) return false; process.kill(pid, 0); return true; } catch { return false; } }
export async function readJson(path) {
  try { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function atomicJson(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
  await rename(temporary, path);
}
export async function inspect(config) {
  const { stdout } = await exec(config.powershellExe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', join(config.runtimeRoot, 'app-info.ps1'), '-AppHint', config.appExeHint], { windowsHide: true, timeout: 20000, encoding: 'utf8', maxBuffer: 65536 });
  const info = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  if (!info.official || info.device !== config.device) throw new Error('APP_IDENTITY_CHECK_FAILED');
  return info;
}
export function nativeWidthSufficient(probe) {
  const parse = value => /^\s*(\d+(?:\.\d+)?)%\s*$/.exec(value ?? '');
  const thread = parse(probe?.metrics?.threadVariable), composer = parse(probe?.metrics?.composerVariable);
  return Boolean(!probe?.present && thread && composer && Number(thread[1]) >= 90 && Number(composer[1]) >= 90);
}
// Test dependencies never come from runtime.local.json or command-line flags.
export async function runController(config, { inspectApp = inspect, spawnApp = spawn } = {}) {
  const stateRoot = join(config.runtimeRoot, 'state');
  await mkdir(stateRoot, { recursive: true });
  const statusPath = join(stateRoot, 'status.json'), requestPath = join(stateRoot, 'request.json');
  const lockRoot = join(stateRoot, 'controller.lock');
  const save = value => atomicJson(statusPath, { updatedAt: new Date().toISOString(), transport: 'inherited-pipe', tcpPortOpened: false, featureRevision: 'multi-window.1', ...value });
  let ownsLock = false, client, child, interrupted = false, eventListener;
  const windows = new Map(), sessions = new Map();
  const sessionKey = randomUUID();
  const restoreOwnedWindows = async () => {
    if (!client || client.closed) return;
    await Promise.all([...windows.values()].filter(window => window.applied && window.sessionId).map(async window => {
      try { await client.evaluate(expressionFor('restore'), window.sessionId); window.applied = false; }
      catch { /* Keep the uncertain ownership state for the final report. */ }
    }));
  };
  try {
    const info = await inspectApp(config);
    if (info.running.length) throw new Error('CLIENT_ALREADY_RUNNING');
    try { await mkdir(lockRoot); ownsLock = true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await readJson(join(lockRoot, 'owner.json'));
      if (!owner || alive(owner.pid)) throw new Error('CONTROLLER_LOCKED');
      await unlink(join(lockRoot, 'owner.json'));
      await rmdir(lockRoot);
      await mkdir(lockRoot); ownsLock = true;
    }
    await atomicJson(join(lockRoot, 'owner.json'), { pid: process.pid, sessionKey });
    await save({ mode: 'starting', controllerPid: process.pid, sessionKey });
    child = spawnApp(info.appExe, ['--remote-debugging-pipe'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('APP_START_FAILED'))); });
    client = new PipeClient(child.stdio[4], child.stdio[3]);
    await client.send('Browser.getVersion');
    let desired = 'apply', revision = 0, lastRequest = null, completedRequest = null;
    let initialized = false, targetsDirty = true, statusDirty = true, nextScan = 0;
    const startupDeadline = Date.now() + 12000;
    const forget = targetId => {
      const window = windows.get(targetId);
      if (!window) return;
      windows.delete(targetId);
      sessions.delete(window.sessionId);
      statusDirty = true;
    };
    eventListener = event => {
      if (['Target.targetCreated', 'Target.targetInfoChanged', 'Target.targetDestroyed', 'Target.detachedFromTarget'].includes(event.method)) targetsDirty = true;
      if (event.method === 'Target.targetDestroyed') forget(event.params?.targetId);
      if (event.method === 'Target.detachedFromTarget') {
        const window = sessions.get(event.params?.sessionId);
        if (window) forget(window.targetId);
      }
      const window = sessions.get(event.sessionId);
      if (window && event.method === 'Runtime.executionContextsCleared') {
        window.generation++;
        window.pending = true;
        window.applied = false;
        window.reloads++;
        window.retryAt = 0;
        statusDirty = true;
      }
    };
    client.on('event', eventListener);
    await client.send('Target.setDiscoverTargets', { discover: true });
    const reconcile = async () => {
      const wasDirty = targetsDirty;
      targetsDirty = false;
      const { targetInfos } = await client.send('Target.getTargets');
      const targets = selectMainTargets(targetInfos);
      const current = new Set(targets.map(target => target.targetId));
      for (const [targetId, window] of windows) {
        if (current.has(targetId)) continue;
        forget(targetId);
        if (window.sessionId) await client.send('Target.detachFromTarget', { sessionId: window.sessionId }).catch(() => {});
      }
      for (const target of targets) {
        if (windows.has(target.targetId)) continue;
        windows.set(target.targetId, { targetId: target.targetId, sessionId: null, generation: 0, revision: -1,
          pending: true, applied: false, excluded: false, result: null, error: null, retryAt: 0, reloads: 0 });
        statusDirty = true;
      }
      if (wasDirty) statusDirty = true;
      nextScan = Date.now() + 1000;
    };
    const updateWindow = async window => {
      const current = () => windows.get(window.targetId) === window;
      let generation;
      const operationRevision = revision, action = desired;
      try {
        if (!window.sessionId) {
          const attached = await client.send('Target.attachToTarget', { targetId: window.targetId, flatten: true });
          if (!current()) {
            await client.send('Target.detachFromTarget', { sessionId: attached.sessionId }).catch(() => {});
            return;
          }
          window.sessionId = attached.sessionId;
          sessions.set(window.sessionId, window);
          await client.send('Runtime.enable', {}, window.sessionId);
        }
        generation = window.generation;
        const readiness = await client.evaluate('({ready: Boolean(document.body && document.head), windowType: document.documentElement?.dataset.codexWindowType ?? null})', window.sessionId);
        if (!current() || generation !== window.generation) return;
        if (!readiness?.ready || !readiness.windowType) { window.retryAt = Date.now() + 200; return; }
        if (readiness.windowType !== 'electron') {
          window.excluded = true;
          window.pending = false;
          window.revision = operationRevision;
          window.error = null;
          statusDirty = true;
          return;
        }
        window.excluded = false;
        const probe = await client.evaluate(expressionFor('status'), window.sessionId);
        if (!current() || generation !== window.generation) return;
        let result;
        if (action === 'apply' && nativeWidthSufficient(probe)) {
          window.applied = false;
          result = { nativeSufficient: true, metrics: probe.metrics };
        } else {
          // Treat a timed-out apply as potentially installed until restoration
          // is confirmed. Renderer-side validation also rolls back on failure.
          if (action === 'apply') window.applied = true;
          result = await client.evaluate(expressionFor(action), window.sessionId);
          if (!current() || generation !== window.generation) return;
          window.applied = action === 'apply';
        }
        window.result = result;
        window.revision = operationRevision;
        window.pending = false;
        window.error = null;
        initialized = true;
        statusDirty = true;
      } catch (error) {
        if (!current() || client.closed || (generation !== undefined && generation !== window.generation)) return;
        const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'WINDOW_UPDATE_FAILED';
        if (window.error !== code) statusDirty = true;
        window.error = code;
        window.retryAt = Date.now() + 1000;
        targetsDirty = true;
      }
    };
    const report = () => {
      const tracked = [...windows.values()], chat = tracked.filter(window => !window.excluded);
      const complete = !targetsDirty && tracked.every(window => !window.pending && !window.error && window.revision === revision);
      if (complete && lastRequest) completedRequest = lastRequest;
      const native = chat.length > 0 && chat.every(window => window.result?.nativeSufficient);
      return save({ mode: initialized ? (desired === 'restore' && complete ? 'restored' : desired === 'apply' && complete && native ? 'native' : 'active') : 'starting',
        controllerPid: process.pid, appPid: child.pid, sessionKey, widthPercent: 90,
        desiredAction: desired, windowCount: chat.length, readyWindowCount: chat.filter(window => !window.pending && !window.error).length,
        excludedWindowCount: tracked.length - chat.length, complete,
        result: chat.find(window => window.result)?.result ?? null,
        ...(completedRequest ? { requestId: completedRequest } : {}),
        reappliedAfterReload: tracked.some(window => window.reloads > 0 && !window.pending && !window.error),
        windows: chat.map(window => ({ targetId: window.targetId, state: window.error ? 'error' : window.pending ? 'pending' : window.result?.nativeSufficient ? 'native' : desired === 'restore' ? 'restored' : 'active',
          applied: window.applied, reloads: window.reloads, ...(window.error ? { error: window.error } : {}) })),
      });
    };
    const stop = () => { interrupted = true; };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      while (!interrupted && !client.closed) {
        const request = await readJson(requestPath);
        if (request?.sessionKey === sessionKey && request.requestId !== lastRequest && ['restore', 'apply'].includes(request.action)) {
          lastRequest = request.requestId;
          desired = request.action;
          revision++;
          for (const window of windows.values()) { window.pending = true; window.retryAt = 0; }
          targetsDirty = true;
          statusDirty = true;
        }
        if (targetsDirty || Date.now() >= nextScan) await reconcile();
        await Promise.all([...windows.values()].filter(window => window.pending && Date.now() >= window.retryAt).map(updateWindow));
        if (statusDirty) { statusDirty = false; await report(); }
        if (!initialized && Date.now() >= startupDeadline) throw new Error(windows.size ? 'RENDERER_NOT_READY' : 'MAIN_WINDOW_NOT_FOUND');
        await sleep(300);
      }
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
    if (interrupted) await restoreOwnedWindows();
    await save({ mode: interrupted && [...windows.values()].some(window => window.applied) ? 'restoration-unconfirmed' : alive(child.pid) ? 'connection-ended' : 'app-exited', controllerPid: process.pid, appPid: child.pid, sessionKey });
  } catch (error) {
    await restoreOwnedWindows();
    await save({ mode: [...windows.values()].some(window => window.applied) ? 'restoration-unconfirmed' : 'failed', controllerPid: process.pid, appPid: child?.pid, sessionKey, error: /^[A-Z_]+$/.test(error.message) ? error.message : 'CONTROLLER_FAILED' });
  } finally {
    if (eventListener) client?.removeListener('event', eventListener);
    client?.close();
    if (child) child.unref();
    if (ownsLock) { await unlink(join(lockRoot, 'owner.json')).catch(() => {}); await rmdir(lockRoot).catch(() => {}); }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = await readJson(process.argv[2]);
  await runController(config);
}
