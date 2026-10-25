import { createReadStream, createWriteStream } from 'node:fs';
const input = createReadStream(null, { fd: 3 });
const output = createWriteStream(null, { fd: 4 });
let buffer = Buffer.alloc(0);
input.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  let end;
  while ((end = buffer.indexOf(0)) >= 0) {
    const request = JSON.parse(buffer.subarray(0, end).toString());
    buffer = buffer.subarray(end + 1);
    const response = Buffer.from(JSON.stringify({ id: request.id, result: { value: '管道验证', sessionId: request.sessionId ?? null } }) + '\0');
    const unicodeStart = response.indexOf(Buffer.from('管'));
    output.write(response.subarray(0, unicodeStart + 1));
    output.write(response.subarray(unicodeStart + 1));
  }
});
input.on('end', () => output.end());
