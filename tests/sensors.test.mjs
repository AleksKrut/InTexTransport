import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sensorValue, calibrationPoints } from '../src/sensors.ts';
const sensor = { name: 'Бак', parameter: 'adc1', kind: 'fuel', unit: 'л', factor: 2, offset: 10, calibration: '0;0\n100;50\n200;150' };
test('sensor applies scale before piecewise calibration and preserves zero', () => {
  assert.equal(sensorValue(sensor, { adc1: 70 }), '100 л');
  assert.equal(sensorValue({ ...sensor, factor: 1, offset: 0 }, { adc1: 0 }), '0 л');
  assert.equal(sensorValue({ ...sensor, factor: 1, offset: 0 }, { adc1: 200 }), '150 л');
});
test('missing, invalid and out of range values never become zero fuel', () => {
  assert.equal(sensorValue(sensor, {}), 'Нет данных');
  assert.equal(sensorValue(sensor, { adc1: 'bad' }), 'Некорректные данные');
  assert.equal(sensorValue(sensor, { adc1: 1000 }), 'Вне тарировки');
  assert.equal(sensorValue({ ...sensor, kind: 'digital' }, { adc1: false }), 'Выключено');
});
test('invalid calibration is rejected', () => {
  for (const text of ['0;0', '0;0\n0;100', '10;5\n1;3', 'x;0\n1;1']) assert.throws(() => calibrationPoints(text));
});
