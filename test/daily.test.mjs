import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseLaunchAction } from '../entry.mjs';
import { nativeWidthSufficient } from '../controller.mjs';

test('repeated launches activate a managed window instead of starting another controller', () => {
  assert.equal(chooseLaunchAction({ enabled: true, running: true, managed: true }), 'activate-managed');
  assert.equal(chooseLaunchAction({ enabled: true, running: true, managed: false }), 'activate-unmanaged');
});
test('cold start honors the persistent setting', () => {
  assert.equal(chooseLaunchAction({ enabled: true, running: false, managed: false }), 'start-wide');
  assert.equal(chooseLaunchAction({ enabled: false, running: false, managed: false }), 'start-official');
});
test('native width requires both native variables to meet 90 percent', () => {
  assert.equal(nativeWidthSufficient({ present: false, metrics: { threadVariable: '90%', composerVariable: '100%' } }), true);
  for (const probe of [
    { present: true, metrics: { threadVariable: '90%', composerVariable: '90%' } },
    { present: false, metrics: { threadVariable: '48rem', composerVariable: '90%' } },
    { present: false, metrics: { threadVariable: '100%', composerVariable: '80%' } },
    { present: false, metrics: { threadVariable: 'none', composerVariable: 'none' } },
  ]) assert.equal(nativeWidthSufficient(probe), false);
});
