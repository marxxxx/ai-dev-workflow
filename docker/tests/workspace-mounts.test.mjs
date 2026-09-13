import test from 'node:test';
import assert from 'node:assert/strict';
import { nestedMounts } from '../workspace-mounts.mjs';

// Field 5 (index 4) of /proc/self/mountinfo is the mount point.
function line(id, mountPoint) {
  return `${id} 30 0:${id} / ${mountPoint} rw,relatime shared:1 - ext4 /dev/sda1 rw`;
}

test('returns mounts strictly below the workspace', () => {
  const mountinfo = [
    line(31, '/'),
    line(32, '/workspace'),
    line(33, '/workspace/apps/web/node_modules'),
    line(34, '/home/dev'),
    line(35, '/workspace-other/node_modules'),
    line(36, '/etc/hosts'),
  ].join('\n');
  assert.deepEqual(nestedMounts(mountinfo), ['/workspace/apps/web/node_modules']);
});

test('resolves octal escapes in mount points', () => {
  const mountinfo = [
    line(32, '/workspace'),
    line(33, '/workspace/my\\040project/node_modules'),
    line(34, '/workspace/tab\\011dir/node_modules'),
  ].join('\n');
  assert.deepEqual(nestedMounts(mountinfo), [
    '/workspace/my project/node_modules',
    '/workspace/tab\tdir/node_modules',
  ]);
});

test('reports an overlaid mount point once', () => {
  const mountinfo = [
    line(33, '/workspace/node_modules'),
    line(34, '/workspace/node_modules'),
  ].join('\n');
  assert.deepEqual(nestedMounts(mountinfo), ['/workspace/node_modules']);
});

test('honours an alternative root and tolerates malformed input', () => {
  assert.deepEqual(nestedMounts(line(33, '/srv/app/deps'), '/srv/app'), ['/srv/app/deps']);
  assert.deepEqual(nestedMounts(''), []);
  assert.deepEqual(nestedMounts('garbage\n33 30 0:33\n'), []);
  assert.deepEqual(nestedMounts(undefined), []);
});
