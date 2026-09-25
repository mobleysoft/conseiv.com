import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failuresLog = path.join(repoRoot, 'logs', 'backup_verify_failures.log');

test('backup-verify-alert.sh appends a durable log entry with the given message', async () => {
  await rm(failuresLog, { force: true });
  const marker = `test-marker-${Date.now()}`;

  await execFileAsync('bash', ['scripts/backup-verify-alert.sh', `D1 backup/restore verification failed - ${marker}`], { cwd: repoRoot });

  const contents = await readFile(failuresLog, 'utf8');
  const lines = contents.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z D1 backup\/restore verification failed - test-marker-\d+$/);
  assert.ok(lines[0].includes(marker));
});

test('backup-verify-alert.sh requires a message argument', async () => {
  await assert.rejects(execFileAsync('bash', ['scripts/backup-verify-alert.sh'], { cwd: repoRoot }));
});
