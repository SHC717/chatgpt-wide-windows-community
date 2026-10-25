import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJson, readJson, runController, sleep } from '../controller.mjs';
import { expressionFor } from '../width-style.mjs';

// A bounded CDP peer tests the controller lifecycle without touching the app.
function browserPeer({ native = false, initial = ['owned'] } = {}) {
  const child = new EventEmitter();
  child.pid = process.pid;
  child.unref = () => {};
  const commands = new PassThrough(), replies = new PassThrough();
  child.stdio = [null, null, null, commands, replies];
  let buffer = '', failDiscovery = false;
  const windows = new Map(), attached = [];
  for (const item of initial) {
    const value = typeof item === 'string' ? { targetId: item } : item;
    windows.set(value.targetId, { type: 'page', url: 'app://-/index.html', windowType: 'electron', ready: true,
      native, styled: false, applies: 0, restores: 0, ...value });
  }
  const metrics = window => ({ threadVariable: window.native || window.styled ? '90%' : '48rem', composerVariable: window.native || window.styled ? '90%' : '736px' });
  const send = value => replies.write(JSON.stringify(value) + '\0');
  commands.on('data', chunk => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      let result = {};
      const reject = () => send({ id: message.id, error: { code: -32000, message: 'fixture target unavailable' } });
      if (message.method === 'Target.getTargets') {
        if (failDiscovery) { failDiscovery = false; reject(); continue; }
        result = { targetInfos: [...windows.values()].map(({ type, url, targetId }) => ({ type, url, targetId })) };
      }
      if (message.method === 'Target.attachToTarget') {
        if (!windows.has(message.params.targetId)) { reject(); continue; }
        attached.push(message.params.targetId);
        result = { sessionId: message.params.targetId + '-session' };
      }
      if (message.method === 'Runtime.evaluate') {
        const targetId = message.sessionId.slice(0, -'-session'.length);
        const window = windows.get(targetId);
        if (!window) { reject(); continue; }
        const expression = message.params.expression;
        let value;
        if (expression.startsWith('({ready:')) value = { ready: window.ready, windowType: window.windowType };
        else if (expression === expressionFor('status')) value = { present: window.styled, metrics: metrics(window) };
        else if (expression === expressionFor('apply')) {
          if (window.closeOnApply) {
            windows.delete(targetId);
            send({ method: 'Target.targetDestroyed', params: { targetId } });
            reject(); continue;
          }
          window.styled = true; window.applies++; value = { applied: true, after: metrics(window) };
          if (window.reloadOnApply) {
            window.reloadOnApply = false;
            window.styled = false;
            send({ sessionId: message.sessionId, method: 'Runtime.executionContextsCleared' });
          }
        }
        else if (expression === expressionFor('restore')) { window.styled = false; window.restores++; value = { restored: true, metrics: metrics(window) }; }
        else throw new Error('UNEXPECTED_EXPRESSION');
        result = { result: { value } };
      }
      send({ id: message.id, result });
    }
  });
  return {
    child,
    spawn(executable, args, options) {
      assert.equal(executable, 'fixture-app');
      assert.deepEqual(args, ['--remote-debugging-pipe']);
      assert.deepEqual(options.stdio, ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']);
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    open(targetId, options = {}, notify = true) {
      windows.set(targetId, { targetId, type: 'page', url: 'app://-/index.html', windowType: 'electron',
        ready: true, native: false, styled: false, applies: 0, restores: 0, ...options });
      if (notify) send({ method: 'Target.targetCreated', params: { targetInfo: { targetId } } });
    },
    reload(targetId = 'owned') {
      windows.get(targetId).styled = false;
      send({ sessionId: targetId + '-session', method: 'Runtime.executionContextsCleared' });
    },
    destroy(targetId, notify = true) {
      windows.delete(targetId);
      if (notify) send({ method: 'Target.targetDestroyed', params: { targetId } });
    },
    window(targetId = 'owned') { return windows.get(targetId); },
    failNextDiscovery() { failDiscovery = true; send({ method: 'Target.targetInfoChanged', params: {} }); },
    close() { replies.end(); },
    get styled() { return windows.get('owned')?.styled ?? false; },
    get applies() { return windows.get('owned')?.applies ?? 0; },
    get attached() { return attached; },
  };
}
async function until(read, predicate) {
  for (let i = 0; i < 200; i++) {
    const value = await read();
    if (predicate(value)) return value;
    await sleep(25);
  }
  throw new Error('FIXTURE_WAIT_TIMEOUT');
}
test('daily controller restores, reapplies, survives reload and releases its lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-width-controller-'));
  const peer = browserPeer();
  const running = runController({ runtimeRoot: root }, { inspectApp: async () => ({ running: [], appExe: 'fixture-app' }), spawnApp: peer.spawn });
  const statusPath = join(root, 'state', 'status.json');
  try {
    const initial = await until(() => readJson(statusPath), value => value?.mode === 'active');
    assert.equal(initial.tcpPortOpened, false);
    await atomicJson(join(root, 'state', 'request.json'), { requestId: 'restore', sessionKey: initial.sessionKey, action: 'restore' });
    await until(() => readJson(statusPath), value => value?.requestId === 'restore');
    assert.equal(peer.styled, false);
    await atomicJson(join(root, 'state', 'request.json'), { requestId: 'apply', sessionKey: initial.sessionKey, action: 'apply' });
    await until(() => readJson(statusPath), value => value?.requestId === 'apply');
    assert.equal(peer.styled, true);
    peer.reload();
    await until(() => readJson(statusPath), value => value?.reappliedAfterReload);
    assert.equal(peer.styled, true);
    assert.equal(peer.applies, 3);
  } finally {
    peer.close();
    await running;
    await assert.rejects(import('node:fs/promises').then(fs => fs.stat(join(root, 'state', 'controller.lock'))), { code: 'ENOENT' });
    await rm(root, { recursive: true });
  }
});

async function withController(peer, check) {
  const root = await mkdtemp(join(tmpdir(), 'codex-width-multiple-'));
  const statusPath = join(root, 'state', 'status.json');
  const running = runController({ runtimeRoot: root }, {
    inspectApp: async () => ({ running: [], appExe: 'fixture-app' }), spawnApp: peer.spawn,
  });
  try {
    const initial = await until(() => readJson(statusPath), value => ['active', 'native'].includes(value?.mode));
    const status = predicate => until(() => readJson(statusPath), predicate);
    const request = async (action, requestId) => {
      await atomicJson(join(root, 'state', 'request.json'), { requestId, sessionKey: initial.sessionKey, action });
      return status(value => value?.requestId === requestId);
    };
    await check({ initial, status, request, statusPath, root });
  } finally {
    peer.close();
    await running;
    await rm(root, { recursive: true });
  }
}

test('all initial chat windows are managed while unrelated and non-electron pages are excluded', async () => {
  const peer = browserPeer({ initial: [
    'owned', 'second', { targetId: 'native', native: true },
    { targetId: 'browser', url: 'https://example.invalid/' },
    { targetId: 'worker', type: 'service_worker' },
    { targetId: 'non-chat', windowType: 'browser' },
  ] });
  await withController(peer, async ({ initial, request }) => {
    assert.equal(initial.windowCount, 3);
    assert.equal(initial.readyWindowCount, 3);
    assert.equal(initial.excludedWindowCount, 1);
    assert.equal(initial.complete, true);
    assert.deepEqual(peer.attached.sort(), ['native', 'non-chat', 'owned', 'second']);
    assert.equal(peer.window('owned').styled, true);
    assert.equal(peer.window('second').styled, true);
    assert.equal(peer.window('native').applies, 0);
    await request('restore', 'restore-all');
    for (const id of ['owned', 'second', 'native']) assert.equal(peer.window(id).styled, false);
    assert.equal(peer.window('non-chat').restores, 0);
    await request('apply', 'apply-all');
    assert.equal(peer.window('second').styled, true);
    assert.equal(peer.window('native').applies, 0);
  });
});

test('new and reloaded windows inherit the current choice and survive the original window closing', async () => {
  const peer = browserPeer();
  await withController(peer, async ({ status, request }) => {
    peer.open('second');
    await status(value => value?.windowCount === 2 && value.complete);
    assert.equal(peer.window('second').styled, true);
    peer.reload('second');
    await status(value => value?.windows?.some(window => window.targetId === 'second' && window.reloads === 1 && window.state === 'active'));
    assert.equal(peer.window('second').applies, 2);
    peer.destroy('owned');
    await status(value => value?.windowCount === 1 && value.complete);
    assert.equal(peer.window('second').styled, true);
    await request('restore', 'restore-second');
    assert.equal(peer.window('second').styled, false);
    peer.open('third');
    await status(value => value?.windowCount === 2 && value.mode === 'restored' && value.complete);
    assert.equal(peer.window('third').applies, 0);
    assert.equal(peer.window('third').restores, 1);
    peer.reload('third');
    await status(value => value?.windows?.some(window => window.targetId === 'third' && window.reloads === 1 && window.state === 'restored'));
    assert.equal(peer.window('third').styled, false);
    await request('apply', 'apply-remaining');
    assert.equal(peer.window('second').styled, true);
    assert.equal(peer.window('third').styled, true);
    peer.destroy('second'); peer.destroy('third');
    await status(value => value?.windowCount === 0 && value.complete);
    peer.open('fourth');
    await status(value => value?.windowCount === 1 && value.complete);
    assert.equal(peer.window('fourth').styled, true);
  });
});

test('periodic discovery repairs missed creation and close events without reinjecting stable windows', async () => {
  const peer = browserPeer();
  await withController(peer, async ({ status }) => {
    peer.open('unannounced', {}, false);
    await status(value => value?.windowCount === 2 && value.complete);
    assert.equal(peer.window('unannounced').styled, true);
    assert.equal(peer.applies, 1);
    peer.destroy('unannounced', false);
    await status(value => value?.windowCount === 1 && value.complete);
    assert.equal(peer.applies, 1);
  });
});

test('an unready window does not block others or falsely acknowledge an all-window request', async () => {
  const peer = browserPeer();
  await withController(peer, async ({ initial, status, request, root, statusPath }) => {
    peer.open('loading', { ready: false });
    peer.open('healthy');
    await status(value => value?.windowCount === 3 && value.readyWindowCount === 2);
    assert.equal(peer.window('healthy').styled, true);
    await atomicJson(join(root, 'state', 'request.json'), { requestId: 'restore-loading', sessionKey: initial.sessionKey, action: 'restore' });
    await status(value => value?.desiredAction === 'restore' && value.readyWindowCount === 2);
    assert.notEqual((await readJson(statusPath)).requestId, 'restore-loading');
    assert.equal(peer.window('owned').styled, false);
    assert.equal(peer.window('healthy').styled, false);
    peer.window('loading').ready = true;
    await status(value => value?.requestId === 'restore-loading' && value.complete);
    assert.equal(peer.window('loading').styled, false);
    await request('apply', 'apply-after-ready');
    assert.equal(peer.window('loading').styled, true);
  });
});

test('a window disappearing during apply leaves the other windows and controller operational', async () => {
  const peer = browserPeer();
  await withController(peer, async ({ status, request }) => {
    peer.open('closing', { closeOnApply: true });
    peer.open('survivor');
    await status(value => value?.windowCount === 2 && value.complete && value.windows.some(window => window.targetId === 'survivor'));
    assert.equal(peer.window('closing'), undefined);
    assert.equal(peer.window('survivor').styled, true);
    await request('restore', 'restore-after-close-race');
    assert.equal(peer.window('owned').styled, false);
    assert.equal(peer.window('survivor').styled, false);
  });
});

test('reload during an in-flight apply is retried for the replacement document', async () => {
  const peer = browserPeer();
  await withController(peer, async ({ status }) => {
    peer.open('reloading', { reloadOnApply: true });
    await status(value => value?.windowCount === 2 && value.complete && value.windows.some(window => window.targetId === 'reloading' && window.reloads === 1));
    assert.equal(peer.window('reloading').styled, true);
    assert.equal(peer.window('reloading').applies, 2);
    assert.equal(peer.applies, 1);
  });
});

test('a controller failure restores every owned window before releasing the connection', async () => {
  const peer = browserPeer({ initial: ['owned', 'second'] });
  await withController(peer, async ({ status }) => {
    peer.failNextDiscovery();
    const failed = await status(value => value?.mode === 'failed');
    assert.equal(failed.error, 'CDP_COMMAND_REJECTED');
    assert.equal(peer.window('owned').styled, false);
    assert.equal(peer.window('second').styled, false);
    assert.equal(peer.window('owned').restores, 1);
    assert.equal(peer.window('second').restores, 1);
  });
});
test('native wide chat skips injection and an existing app is never replaced', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-width-native-'));
  const peer = browserPeer({ native: true });
  const running = runController({ runtimeRoot: root }, { inspectApp: async () => ({ running: [], appExe: 'fixture-app' }), spawnApp: peer.spawn });
  try {
    await until(() => readJson(join(root, 'state', 'status.json')), value => value?.mode === 'native');
    assert.equal(peer.applies, 0);
    peer.close();
    await running;
    await runController({ runtimeRoot: root }, {
      inspectApp: async () => ({ running: [{ pid: 123 }] }),
      spawnApp() { assert.fail('an existing app must not be replaced'); },
    });
    assert.equal((await readJson(join(root, 'state', 'status.json'))).error, 'CLIENT_ALREADY_RUNNING');
  } finally { peer.close(); await running; await rm(root, { recursive: true }); }
});
