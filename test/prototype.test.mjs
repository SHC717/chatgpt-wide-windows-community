import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { PipeClient, selectMainTargets } from '../pipe-client.mjs';
import { expressionFor, STYLE_ID, OWNER, WIDTH_CSS } from '../width-style.mjs';

test('real Windows child-process pipes preserve fragmented UTF-8 and session IDs', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./pipe-fixture.mjs', import.meta.url))], {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let errorOutput = '';
  child.stderr.on('data', chunk => { errorOutput += chunk; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const client = new PipeClient(child.stdio[4], child.stdio[3], { timeoutMs: 3000 });
  try {
    assert.deepEqual(await client.send('Fixture.check', {}, 'isolated-session'), { value: '管道验证', sessionId: 'isolated-session' });
  } catch (error) {
    throw new Error(`${error.message}; fixture: ${errorOutput}`);
  } finally {
    client.close();
    await exited;
  }
});

test('missing peer times out without opening a TCP fallback', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const client = new PipeClient(input, output, { timeoutMs: 15 });
  await assert.rejects(client.send('Browser.getVersion'), /PIPE_TIMEOUT/);
  assert.equal(client.pending.size, 0);
  client.close();
});

test('closed pipe rejects outstanding requests', async () => {
  const client = new PipeClient(new PassThrough(), new PassThrough());
  const pending = client.send('Browser.getVersion');
  client.close();
  await assert.rejects(pending, /PIPE_CLOSED/);
});

test('oversized and malformed frames are rejected', async () => {
  for (const [frame, expected] of [['not-json\0', /PIPE_BAD_FRAME/], ['1234567890123456', /PIPE_FRAME_TOO_LARGE/]]) {
    const input = new PassThrough(), output = new PassThrough();
    const client = new PipeClient(input, output, { maxFrameBytes: 10 });
    const pending = client.send('x');
    input.write(Buffer.from(frame));
    await assert.rejects(pending, expected);
    client.close();
  }
});

test('renderer selection includes every main window and excludes other targets', () => {
  const target = { type: 'page', url: 'app://-/index.html', targetId: 'owned' };
  const second = { ...target, url: 'app://-/index.html?windowId=second#/thread/example', targetId: 'second' };
  const unrelated = [
    { type: 'page', url: 'https://chatgpt.com/' },
    { type: 'page', url: 'app://-/browser.html' },
    { type: 'page', url: 'app://other/index.html' },
    { type: 'service_worker', url: 'app://-/index.html' },
    { type: 'page', url: 'not-a-url' },
  ];
  assert.deepEqual(selectMainTargets(unrelated), []);
  assert.deepEqual(selectMainTargets([target, ...unrelated, second]), [target, second]);
});

// Minimal renderer fixture exercises ownership, computed-style checks and
// rollback. It does NOT claim to measure Chromium or the live app's geometry.
function rendererFixture({ windowType = 'electron', fontChanges = false, sidebarChanges = false, suspendedFrames = false } = {}) {
  const elements = new Map();
  const rectangle = { x: 0, y: 0, width: 240, height: 900 };
  const sidebar = { getBoundingClientRect: () => ({ ...rectangle, width: sidebarChanges && elements.has(STYLE_ID) ? 260 : 240 }) };
  const body = {};
  const document = {
    body, documentElement: { dataset: { codexWindowType: windowType } },
    getElementById: id => elements.get(id),
    querySelectorAll: selector => selector.startsWith('aside,') ? [sidebar] : [],
    createElement: () => ({ dataset: {}, textContent: '', remove() { elements.delete(this.id); } }),
    head: { appendChild(element) { elements.set(element.id, element); } },
  };
  const context = vm.createContext({
    document, innerWidth: 1600, innerHeight: 1000,
    requestAnimationFrame: callback => { if (!suspendedFrames) callback(); },
    setTimeout, clearTimeout,
    getComputedStyle: () => ({
      fontSize: fontChanges && elements.has(STYLE_ID) ? '18px' : '16px',
      getPropertyValue: name => {
        if (name === '--app-shell-left-panel-width') return '240px';
        if (elements.has(STYLE_ID)) return '90%';
        return name === '--thread-content-max-width' ? '48rem' : '736px';
      },
    }),
  });
  return { elements, run: action => vm.runInContext(expressionFor(action), context) };
}

test('apply and restore preserve unrelated styles and recover original width variables', async () => {
  const fixture = rendererFixture();
  fixture.elements.set('unrelated-style', { textContent: 'user existing style' });
  const result = await fixture.run('apply');
  assert.equal(result.applied, true);
  assert.equal(result.after.threadVariable, '90%');
  assert.equal(result.after.bodyFont, '16px');
  assert.equal(result.after.sidebar.width, 240);
  assert.equal(fixture.elements.get(STYLE_ID).dataset.owner, OWNER);
  const restored = await fixture.run('restore');
  assert.equal(restored.restored, true);
  assert.equal(restored.metrics.threadVariable, '48rem');
  assert.equal(fixture.elements.get('unrelated-style').textContent, 'user existing style');
});

test('wrong window and conflicting style ownership stop without modifications', async () => {
  const wrong = rendererFixture({ windowType: 'browser' });
  await assert.rejects(wrong.run('apply'), /UNEXPECTED_WINDOW/);
  assert.equal(wrong.elements.size, 0);
  const conflict = rendererFixture();
  conflict.elements.set(STYLE_ID, { dataset: { owner: 'another-owner' }, textContent: 'preserve' });
  await assert.rejects(conflict.run('apply'), /STYLE_ID_CONFLICT/);
  assert.equal(conflict.elements.get(STYLE_ID).textContent, 'preserve');
});

test('font or sidebar changes roll back the injected style', async () => {
  for (const options of [{ fontChanges: true }, { sidebarChanges: true }]) {
    const fixture = rendererFixture(options);
    await assert.rejects(fixture.run('apply'), /FONT_CHANGED|SIDEBAR_WIDTH_CHANGED/);
    assert.equal(fixture.elements.has(STYLE_ID), false);
  }
});

test('background windows finish apply and restore when animation frames are suspended', async () => {
  const fixture = rendererFixture({ suspendedFrames: true });
  const applied = await fixture.run('apply');
  assert.equal(applied.after.threadVariable, '90%');
  assert.equal(fixture.elements.has(STYLE_ID), true);
  assert.equal((await fixture.run('restore')).restored, true);
  assert.equal(fixture.elements.has(STYLE_ID), false);
});

test('the stylesheet has no font, zoom or sidebar declarations', () => {
  assert.doesNotMatch(WIDTH_CSS, /(?:font(?:-size|-family)?|zoom|sidebar)\s*:/i);
  assert.throws(() => expressionFor('arbitrary-action'), /UNKNOWN_ACTION/);
});
