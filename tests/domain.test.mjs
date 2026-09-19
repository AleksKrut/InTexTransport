import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinatesValid, speedKmh, routeQuery, orderedRoute } from '../src/domain.mjs';

test('Traccar knots convert to km/h; missing speed is not zero', () => {
  assert.equal(speedKmh(10), 19);
  assert.equal(speedKmh(0), 0);
  assert.equal(speedKmh(undefined), null);
});
test('rejects invalid fixes while preserving valid equator/Greenwich coordinates', () => {
  assert.equal(coordinatesValid({valid:true, latitude:0, longitude:0}), true);
  assert.equal(coordinatesValid({valid:false, latitude:56, longitude:60}), false);
  assert.equal(coordinatesValid({valid:true, latitude:91, longitude:60}), false);
  assert.equal(coordinatesValid({valid:true, latitude:NaN, longitude:60}), false);
});
test('route period is converted to UTC and bounded', () => {
  const query = routeQuery(1, '2026-09-19T10:00:00+05:00', '2026-09-19T11:00:00+05:00');
  assert.equal(query.get('from'), '2026-09-19T05:00:00.000Z');
  assert.throws(() => routeQuery(null, '', ''));
  assert.throws(() => routeQuery(1, '2026-09-20', '2026-09-19'));
  assert.throws(() => routeQuery(1, '2026-09-01', '2026-09-19'));
});
test('late-arriving telemetry is rendered in fix-time order', () => {
  const point = {valid:true, latitude:56, longitude:60};
  const input = [{...point, fixTime:'2026-09-19T02:00:00Z'},
    {...point, fixTime:'2026-09-19T01:00:00Z'}, {...point, valid:false}];
  const result = orderedRoute(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].fixTime, '2026-09-19T01:00:00Z');
  assert.equal(input[0].fixTime, '2026-09-19T02:00:00Z');
});
