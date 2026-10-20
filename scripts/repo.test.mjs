import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('repository', () => {
  it('no env files are tracked', () => {
    const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
    const envFiles = tracked.filter((path) => /(^|\/)\.env/.test(path));
    expect(envFiles).toEqual(['.env.example']);
  });
});
