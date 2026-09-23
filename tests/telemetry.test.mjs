import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTelemetry, describeParameter } from '../src/telemetry.ts';
const packet = (id, attributes) => ({ id, deviceId: 1, serverTime: `2026-09-20T10:00:0${id}Z`, attributes });
test('discovery retains intermittent parameters and does not invent zeroes', () => {
  const first = mergeTelemetry({ parameters: [] }, packet(1, { adc1: 0, ignition: false }));
  const second = mergeTelemetry(first, packet(2, { adc1: 500, temp1: 12 }));
  assert.equal(second.parameters.find(p => p.key === 'ignition').value, false);
  assert.equal(second.parameters.find(p => p.key === 'ignition').present, false);
  assert.equal(second.parameters.find(p => p.key === 'ignition').lastSeen, first.position.serverTime);
  assert.equal(second.parameters.find(p => p.key === 'adc1').value, 500);
  assert.equal(mergeTelemetry(second, packet(1, { adc1: 0 })), second);
  assert.equal(mergeTelemetry(second, packet(2, { adc1: 0 })), second);
});
test('analog inputs do not imply fuel level or an invented unit', () => {
  assert.equal(describeParameter('adc1', 700).kind, 'number');
  assert.equal(describeParameter('adc1', 700).unit, '');
  assert.equal(describeParameter('unknown', 1).confidence, 'Назначение не определено');
  assert.equal(describeParameter('ignition', false).kind, 'digital');
});
