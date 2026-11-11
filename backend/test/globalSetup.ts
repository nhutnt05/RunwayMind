// Creates a throwaway SQLite database with the real migrations (docs/09 §3) for API tests.
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export default function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'rm-backend-'));
  const url = `file:${join(dir, 'test.db').replace(/\\/g, '/')}`;
  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  process.env.TEST_DATABASE_URL = url;
  return () => rmSync(dir, { recursive: true, force: true });
}
