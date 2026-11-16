import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { CONFIG } from './config.js';
import { resolveRuntimeHost } from './runtime-identity.js';

test('the native product has no invented version', () => {
  expect(resolveRuntimeHost()).toBe('claude-code');
  expect(resolveRuntimeHost(' ')).toBe('claude-code');
});

test('a deliberate host override is validated separately from inherited metadata', () => {
  expect(resolveRuntimeHost('CLAUDE-CODE/2.1.0')).toBe('claude-code/2.1.0');
  expect(() => resolveRuntimeHost('terminal')).toThrow('ALICEREALM_HOST_OVERRIDE');
  expect(() => resolveRuntimeHost('bad/host/version')).toThrow('ALICEREALM_HOST_OVERRIDE');
});


test('config propagates independent identity to a CLI child', () => {
  const result = spawnSync(process.execPath, ['-e', `
    await import('./src/config.ts');
    const { execAliceRealm } = await import('./src/cli-executor.ts');
    const child = await execAliceRealm(process.execPath, ['-e', 'console.log(JSON.stringify({host:process.env.ALICEREALM_HOST,mode:process.env.ALICEREALM_MODE,plugin:process.env.ALICEREALM_PLUGIN_VERSION}))']);
    process.stdout.write(JSON.stringify(child.kind === 'success' ? child.data : child));
    process.exit(child.kind === 'success' ? 0 : 1);
  `], {cwd: new URL('..', import.meta.url).pathname, encoding:'utf8',
    env:{...process.env,ALICEREALM_HOST:'openclaw/old-plugin',ALICEREALM_MODE:'skill',ALICEREALM_HOST_OVERRIDE:''}});
  expect(result.status).toBe(0);
  const identity = JSON.parse(result.stdout);
  expect(identity.host).toBe('claude-code');
  expect(identity.mode).toBe('plugin');
  expect(identity.plugin).toBe(CONFIG.PLUGIN_VERSION);
});

for (const host of ['plugin', 'skill/1', 'skills', 'unknown', 'terminal/1']) {
  test(`rejects mode sentinel ${host} as a product`, () => {
    expect(() => resolveRuntimeHost(host)).toThrow('ALICEREALM_HOST_OVERRIDE');
  });
}

for (const model of ['', 'actual-current-model']) {
  test(`CLI children retain only an explicitly supplied current model: ${model || 'unknown'}`, () => {
    const home = mkdtempSync(join(tmpdir(), 'alicerealm-claude-model-'));
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'configured-default' }));
    try {
      const result = spawnSync(process.execPath, ['-e', `
        await import('./src/config.ts');
        const { execAliceRealm } = await import('./src/cli-executor.ts');
        const result = await execAliceRealm(process.execPath, ['-e', 'console.log(JSON.stringify({model:process.env.ALICEREALM_MODEL || null}))']);
        console.log(JSON.stringify(result));
      `], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8',
        env: { ...process.env, HOME: home, ALICEREALM_HOME: home,
          ALICEREALM_HOST_OVERRIDE: '', ALICEREALM_MODEL: model, ANTHROPIC_MODEL: 'startup-model-alias' } });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ kind: 'success', data: { model: model || null } });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
}
