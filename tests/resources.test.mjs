import test from 'node:test';
import assert from 'node:assert/strict';
import { acceleratorTelemetry, difference, gib, percent, rate, reading, resourceAxis, resourceHistoryWindow, resourceStatus, sampleAge, trendPath, resourceTrend } from '../apps/console/src/features/resources/resource-state.ts';

test('sleep history is distinct from fresh SMI, expiry, pause and lost host connection', () => {
  const card = { smi_ok: false, smi_age: 3600, power_state: 'suspended', core_temp: 90.3 };
  assert.deepEqual(acceleratorTelemetry(card, 1), { age: 3601, mode: 'sleeping', historical: true, canRead: true });
  assert.equal(acceleratorTelemetry(card, 1, false).mode, 'unavailable');
  assert.equal(acceleratorTelemetry(card, 20).mode, 'unavailable');
  assert.equal(acceleratorTelemetry(card, null).mode, 'unavailable');
  const idle = { smi_ok: true, smi_age: 10, smi_interval: 15, smi_valid_for: 18, power_state: 'active' };
  assert.equal(acceleratorTelemetry(idle, 1).mode, 'idle');
  assert.equal(acceleratorTelemetry(idle, 8).mode, 'unavailable');
  assert.equal(acceleratorTelemetry({ ...idle, smi_age: 18 }, 0).mode, 'unavailable');
  assert.equal(acceleratorTelemetry({ smi_ok: true, smi_age: 0 }, 1).mode, 'live');
});
test('manual readings remain snapshots even before the card returns to sleep', () => {
  const card={smi_ok:true,smi_age:0,power_state:'active',smi_interval:15,smi_valid_for:18,smi_manual:true};
  assert.deepEqual(acceleratorTelemetry(card,1),{age:1,mode:'manual',historical:true,canRead:true});
  assert.equal(acceleratorTelemetry({...card,power_state:'suspended',smi_ok:false,smi_age:600},1).mode,'sleeping');
  assert.equal(acceleratorTelemetry(card,1,false).canRead,false);
  assert.deepEqual(acceleratorTelemetry({...card,smi_ok:false,smi_age:3600,smi_interval:0},1),{age:3601,mode:'manual',historical:true,canRead:true});
});

test('resource metrics preserve missing values and genuine zeros with binary units', () => {
  assert.equal(reading(null, 1, '%'), 'N/A');
  assert.equal(reading(NaN), 'N/A');
  assert.equal(reading(0, 1, '%'), '0.0%');
  assert.equal(gib(1024 ** 3), '1.00 GiB');
  assert.equal(rate(null), 'N/A');
  assert.equal(rate(0), '0 B/s');
  assert.equal(rate(2048), '2.0 KiB/s');
  assert.equal(difference(null, 10), null);
  assert.equal(difference(100, 70), 30);
  assert.equal(percent(10, 0), null);
  assert.equal(percent(130, 100), 100);
});
test('a retained sample ages during failures or pause without relying on device wall-clock synchronization', () => {
  const snapshot = { status: 'live', age_seconds: 0.5 };
  const age = sampleAge(snapshot, 1000, 7000);
  assert.equal(age, 6.5);
  assert.equal(resourceStatus(snapshot, age, '', false, true), 'stale');
  assert.equal(resourceStatus(snapshot, 0, 'offline', false, true), 'stale');
  assert.equal(resourceStatus(snapshot, 0, '', true, true), 'paused');
  assert.equal(resourceStatus(snapshot, 0, '', false, false), 'hidden');
  assert.equal(resourceStatus(snapshot, 0.5, '', false, true), 'live');
  assert.equal(resourceStatus(snapshot, 5.5, '', false, true, 7), 'live');
  assert.equal(resourceStatus(null, null, '', false, true), 'warming');
});
test('resource trends break across missing readings and sampling gaps instead of drawing fake zeros', () => {
  const points = [0, 1, 2, 10].map((sec, i) => ({ timestamp: new Date(1000 * sec).toISOString(), cpu: i === 1 ? null : i * 10 }));
  const path = trendPath(points, 'cpu', 100);
  assert.equal((path.match(/M/g) || []).length, 3);
  assert(!path.includes('NaN'));
  assert(trendPath([{ timestamp: '2026-10-19T00:00:00Z', cpu: 0 }], 'cpu', 100).includes('36.0'));
});
test('a resource trend requires consecutive real samples, including valid zero readings', () => {
  const point = (seconds, cpu) => ({ timestamp: new Date(seconds * 1000).toISOString(), cpu });
  assert.deepEqual(resourceTrend([], 'cpu'), { path: '', count: 0, ready: false });
  assert.equal(resourceTrend([point(0, 0)], 'cpu').ready, false);
  assert.equal(resourceTrend([point(0, 0), point(1, 0)], 'cpu').ready, true);
  assert.equal(resourceTrend([point(0, 0), point(1, null), point(2, 10)], 'cpu').ready, false);
  assert.equal(resourceTrend([point(0, 0), point(10, 10)], 'cpu').ready, false);
  const malformed = resourceTrend([point(0, 0), { timestamp: 'invalid', cpu: 50 }, point(1, 10), point(1, 90)], 'cpu');
  assert.equal(malformed.count, 2);
  assert.equal(malformed.ready, false);
  assert(!malformed.path.includes('NaN'));
});

test('adaptive resource axes reveal low readings and grow or shrink with the visible sampling peak', () => {
  assert.deepEqual(resourceAxis([0.4, 0.7, 2.8], 100), { upper: 4, ticks: [0, 1, 2, 3, 4] });
  assert.deepEqual(resourceAxis([2.8, 7], 100), { upper: 10, ticks: [0, 2.5, 5, 7.5, 10] });
  assert.equal(resourceAxis([0.4, 0.7], 100).upper, 1);
  assert.equal(resourceAxis([95], 100).upper, 100);
  assert.equal(resourceAxis([8.3]).upper, 10);
  assert.equal(resourceAxis([120], 100).upper >= 120, true, 'An unexpected observation must not be silently clipped');
});

test('adaptive resource axes retain a stable zero range and ignore missing or invalid values', () => {
  assert.deepEqual(resourceAxis([0, 0, null, NaN, Infinity, -1], 100), { upper: 1, ticks: [0, 0.25, 0.5, 0.75, 1] });
  assert.equal(resourceAxis([]).upper, 1);
  assert.equal(resourceAxis([2.8, null, NaN, Infinity, -20], 100).upper, 4);
});

test('an interrupted resource history focuses on the latest actual segment without mutating the snapshot', () => {
  const point = (seconds, cpu) => ({ timestamp: new Date(seconds * 1000).toISOString(), cpu, ram_available: null, temperature: null });
  const before = Array.from({ length: 54 }, (_, i) => point(i, 95));
  const recent = [point(900, 0), point(901, null), point(902, 0.4), point(903, 0.7)];
  const all = [...before, ...recent], saved = structuredClone(all), window = resourceHistoryWindow(all);
  assert.deepEqual(window, { points: recent, omitted: 54, interrupted: true });
  assert.deepEqual(all, saved);
  assert.equal(window.points[0].cpu, 0);assert.equal(window.points[1].cpu, null);
  assert.equal(resourceAxis(window.points.map(p => p.cpu), 100).upper, 1, 'Old peaks must not flatten the current segment');
  const resumed = resourceHistoryWindow([...before, point(900, 0)]);
  assert.equal(resourceTrend(resumed.points, 'cpu').ready, false, 'Old observations cannot make one new point look like a trend');
});

test('continuous resource windows keep up to 60 original points and need no browser clock', () => {
  const points = Array.from({ length: 90 }, (_, i) => ({ timestamp: new Date(i * 1000).toISOString(), cpu: 0 }));
  const window = resourceHistoryWindow(points);
  assert.deepEqual(window, { points: points.slice(-60), omitted: 30, interrupted: false });
  assert.equal(resourceTrend(window.points, 'cpu').ready, true);
  assert.deepEqual(resourceHistoryWindow([]), { points: [], omitted: 0, interrupted: false });
});

test('invalid, repeated and backward timestamps cannot bridge resource segments', () => {
  const point = seconds => ({ timestamp: new Date(seconds * 1000).toISOString(), cpu: 0 });
  const invalid = { timestamp: 'invalid', cpu: null };
  assert.deepEqual(resourceHistoryWindow([point(0), invalid, point(1), point(2)]).points, [point(1), point(2)]);
  assert.deepEqual(resourceHistoryWindow([point(0), point(1), point(1)]).points, [point(1)]);
  assert.deepEqual(resourceHistoryWindow([point(10), point(11), point(0), point(1)]).points, [point(0), point(1)]);
  assert.deepEqual(resourceHistoryWindow([invalid]), { points: [], omitted: 1, interrupted: true });
  assert.deepEqual(resourceHistoryWindow([point(0), point(1), invalid]).points, [point(0), point(1)]);
});
