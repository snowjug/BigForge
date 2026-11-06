import { describe, expect, it } from 'vitest';
import {
  driftPath,
  economicsPath,
  governancePath,
  learnPath,
  loginPath,
  parseDriftParams,
  parseGovernanceParams,
  parseLearnParams,
  parseLoginParams,
  parseRunParams,
  parseShadowParams,
  reflexPath,
  runPath,
  safeNext,
  settingsPath,
  shadowPath,
  tracePath,
  tracesPath,
} from '../src/routes';

describe('route builders', () => {
  it('builds the documented paths', () => {
    expect(runPath()).toBe('/run');
    expect(runPath({ task: 'tsk_1' })).toBe('/run?task=tsk_1');
    expect(runPath({ task: 'tsk_1', run: 'run_2' })).toBe('/run?task=tsk_1&run=run_2');
    expect(tracesPath()).toBe('/traces');
    expect(tracePath('run_2')).toBe('/traces/run_2');
    expect(learnPath({ family: 'fam_1' })).toBe('/learn?family=fam_1');
    expect(reflexPath('rfv_9')).toBe('/reflexes/rfv_9');
    expect(shadowPath({ version: 'rfv_9' })).toBe('/shadow?version=rfv_9');
    expect(driftPath({ version: 'rfv_9' })).toBe('/drift?version=rfv_9');
    expect(economicsPath()).toBe('/economics');
    expect(governancePath({ tab: 'roles' })).toBe('/governance?tab=roles');
    expect(settingsPath()).toBe('/settings');
  });

  it('omits empty and missing ids instead of emitting empty parameters', () => {
    expect(runPath({ task: null, run: undefined })).toBe('/run');
    expect(learnPath({ family: '' })).toBe('/learn');
    expect(shadowPath()).toBe('/shadow');
    expect(driftPath({ version: null })).toBe('/drift');
  });

  it('encodes path segments and query values', () => {
    expect(tracePath('a/b c')).toBe('/traces/a%2Fb%20c');
    expect(runPath({ task: 'a&b=c' })).toBe('/run?task=a%26b%3Dc');
  });
});

describe('route parsing', () => {
  it('reads ids from a query string or URLSearchParams and returns null when absent', () => {
    expect(parseRunParams('?task=tsk_1&run=run_2')).toEqual({ task: 'tsk_1', run: 'run_2' });
    expect(parseRunParams(new URLSearchParams('task=tsk_1'))).toEqual({ task: 'tsk_1', run: null });
    expect(parseRunParams('')).toEqual({ task: null, run: null });
    expect(parseLearnParams('family=fam_1')).toEqual({ family: 'fam_1' });
    expect(parseShadowParams('version=rfv_9')).toEqual({ version: 'rfv_9' });
    expect(parseDriftParams('version=')).toEqual({ version: null });
  });

  it('round-trips what the builders produce', () => {
    const url = runPath({ task: 'tsk_1', run: 'run_2' });
    expect(parseRunParams(url.split('?')[1] ?? '')).toEqual({ task: 'tsk_1', run: 'run_2' });
  });

  it('falls back to the audit tab for an unknown governance tab', () => {
    expect(parseGovernanceParams('tab=safety').tab).toBe('safety');
    expect(parseGovernanceParams('tab=nope').tab).toBe('audit');
    expect(parseGovernanceParams('').tab).toBe('audit');
  });
});

describe('safeNext (open-redirect guard)', () => {
  it('accepts in-app paths only', () => {
    expect(safeNext('/governance?tab=roles')).toBe('/governance?tab=roles');
    expect(safeNext('/')).toBe('/');
  });

  it('rejects external, protocol-relative, scripted and login targets', () => {
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext('//evil.example')).toBeNull();
    expect(safeNext('/\\evil.example')).toBeNull();
    expect(safeNext('javascript:alert(1)')).toBeNull();
    expect(safeNext('')).toBeNull();
    expect(safeNext(null)).toBeNull();
    expect(safeNext('/login')).toBeNull();
    expect(safeNext('/login?next=/run')).toBeNull();
  });

  it('is applied by loginPath and parseLoginParams', () => {
    expect(loginPath('/run?task=tsk_1')).toBe('/login?next=%2Frun%3Ftask%3Dtsk_1');
    expect(loginPath('https://evil.example')).toBe('/login');
    expect(parseLoginParams('next=%2Fsettings').next).toBe('/settings');
    expect(parseLoginParams('next=https%3A%2F%2Fevil.example').next).toBeNull();
  });
});
