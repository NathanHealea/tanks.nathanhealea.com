import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// PATH points at an empty directory, so if a check lets a run through, npx cannot be found and nothing reaches the
// network; the assertions read the message to tell the two apart.
function deploy(extraEnv) {
  const env = { PATH: mkdtempSync(join(tmpdir(), 'no-npx-')), CLOUDFLARE_API_TOKEN: 'test-token', ...extraEnv };
  const result = spawnSync(process.execPath, [join('scripts', 'deploy.mjs')], { env, encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr };
}

describe('deploy script', () => {
  it('refuses to run without a production deploy key', () => {
    for (const env of [{}, { CONVEX_PROD_DEPLOY_KEY: 'dev:usable-manatee-416|x' }, { CONVEX_PROD_DEPLOY_KEY: '' }]) {
      const { status, stderr } = deploy(env);
      expect(status).toBe(1);
      expect(stderr).toContain('production deploy key');
    }
  });

  it('refuses to run without a Cloudflare token', () => {
    const { status, stderr } = deploy({ CONVEX_PROD_DEPLOY_KEY: 'prod:x|y', CLOUDFLARE_API_TOKEN: '' });
    expect(status).toBe(1);
    expect(stderr).toContain('CLOUDFLARE_API_TOKEN');
  });

  it('with both set, gets past the checks and stops at the first failed step without publishing', () => {
    const { status, stderr } = deploy({ CONVEX_PROD_DEPLOY_KEY: 'prod:x|y' });
    expect(status).not.toBe(0);
    expect(stderr).not.toContain('production deploy key');
    expect(stderr).toContain('the site was not published');
  });
});
