import { EventEmitter } from 'node:events';

// Chromium's inherited pipe protocol: JSON messages terminated by a NUL byte.
export class PipeClient extends EventEmitter {
  constructor(readable, writable, { timeoutMs = 8000, maxFrameBytes = 8 * 1024 * 1024 } = {}) {
    super();
    this.readable = readable;
    this.writable = writable;
    this.timeoutMs = timeoutMs;
    this.maxFrameBytes = maxFrameBytes;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 0;
    this.closed = false;
    readable.on('data', chunk => this.receive(chunk));
    readable.on('end', () => this.fail(new Error('PIPE_CLOSED')));
    readable.on('error', () => this.fail(new Error('PIPE_READ_FAILED')));
    writable.on('error', () => this.fail(new Error('PIPE_WRITE_FAILED')));
  }

  receive(chunk) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let end;
    while ((end = this.buffer.indexOf(0)) >= 0) {
      if (end > this.maxFrameBytes) return this.fail(new Error('PIPE_FRAME_TOO_LARGE'));
      const frame = this.buffer.subarray(0, end);
      this.buffer = this.buffer.subarray(end + 1);
      if (!frame.length) continue;
      let message;
      try { message = JSON.parse(frame.toString('utf8')); }
      catch { return this.fail(new Error('PIPE_BAD_FRAME')); }
      if (!message.id) { this.emit('event', message); continue; }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error('CDP_COMMAND_REJECTED'));
      else pending.resolve(message.result);
    }
    if (this.buffer.length > this.maxFrameBytes) this.fail(new Error('PIPE_FRAME_TOO_LARGE'));
  }

  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error('PIPE_CLOSED'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('PIPE_TIMEOUT'));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const message = { id, method, params };
      if (sessionId) message.sessionId = sessionId;
      try { this.writable.write(Buffer.from(JSON.stringify(message) + '\0')); }
      catch { this.fail(new Error('PIPE_WRITE_FAILED')); }
    });
  }

  async evaluate(expression, sessionId) {
    const result = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    }, sessionId);
    if (result?.exceptionDetails) throw new Error('RENDERER_EVALUATION_FAILED');
    return result?.result?.value;
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
    this.emit('closed');
  }

  close() {
    this.fail(new Error('PIPE_CLOSED'));
    this.writable.destroy();
    this.readable.destroy();
  }
}

export function selectMainTargets(targets) {
  return targets.filter(target => {
    if (target.type !== 'page') return false;
    try {
      const url = new URL(target.url);
      return url.protocol === 'app:' && url.hostname === '-' && url.pathname === '/index.html';
    } catch { return false; }
  });
}

// Preserve the old import during an incremental deployment. New controllers
// use selectMainTargets; pre-fix controllers keep their single-target contract.
export function selectMainTarget(targets) {
  const matches = selectMainTargets(targets);
  if (matches.length !== 1) throw new Error(matches.length ? 'MULTIPLE_MAIN_WINDOWS' : 'MAIN_WINDOW_NOT_FOUND');
  return matches[0];
}
