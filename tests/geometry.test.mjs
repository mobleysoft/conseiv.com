import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMETERS, generateBracket, normalizeParameters, GeometryValidationError, exportOBJ, exportSTL } from '../shared/geometry.js';

function topology(mesh, holes) {
  assert.equal(mesh.vertexCount, mesh.positions.length / 3);
  assert.equal(mesh.triangleCount, mesh.indices.length / 3);
  assert.ok(mesh.positions.every(Number.isFinite));
  const edges = new Map();
  let volume = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = mesh.indices.slice(i, i + 3);
    assert.equal(new Set(ids).size, 3);
    assert.ok(ids.every(n => Number.isInteger(n) && n >= 0 && n < mesh.vertexCount));
    const [a, b, c] = ids.map(n => mesh.positions.slice(n * 3, n * 3 + 3));
    const u = b.map((v, k) => v - a[k]), v = c.map((v, k) => v - a[k]);
    assert.ok(Math.hypot(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]) > 1e-8, 'no degenerate triangle');
    volume += (a[0]*(b[1]*c[2]-b[2]*c[1]) + a[1]*(b[2]*c[0]-b[0]*c[2]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6;
    for (let k = 0; k < 3; k++) {
      const start = ids[k], end = ids[(k + 1) % 3], key = [start, end].sort((a, b) => a - b).join(':');
      const edge = edges.get(key) || { count: 0, direction: 0 };
      edge.count++; edge.direction += start < end ? 1 : -1; edges.set(key, edge);
    }
  }
  assert.ok([...edges.values()].every(e => e.count === 2 && e.direction === 0), 'closed, consistently wound surface');
  assert.equal(mesh.vertexCount - edges.size + mesh.triangleCount, 2 - 2 * holes, 'Euler characteristic matches through holes');
  assert.ok(volume > 0, 'outward normals give positive volume');
  return volume;
}

test('default geometry is deterministic with physical through holes and correct flat volume', () => {
  const g = generateBracket();
  assert.deepEqual(g, generateBracket());
  assert.equal(g.metadata.holeCount, 4);
  topology(g.meshes.bent, 4);
  const volume = topology(g.meshes.flat, 4);
  const circlePolygonArea = 48 / 2 * 3 ** 2 * Math.sin(2 * Math.PI / 48);
  const expected = (g.metadata.totalFlatLength * 40 - 4 * circlePolygonArea) * 3;
  assert.ok(Math.abs(volume - expected) < 1e-6);
  assert.ok(Math.abs(g.metadata.bendAllowance - Math.PI / 2 * (4 + 0.44 * 3)) < 1e-9);
});
for (const angle of [15, 60, 90, 150]) {
  for (const count of [0, 1, 2, 8]) {
    test(`closed geometry for ${angle} degree bend, ${count} holes per leg`, () => {
      const g = generateBracket({ bendAngleDeg: angle, holesPerLeg: count, legAWidth: 180, legBWidth: 180 });
      topology(g.meshes.bent, count * 2); topology(g.meshes.flat, count * 2);
    });
  }
}
test('rejects malformed, unknown, non-finite and impossible geometry', () => {
  for (const input of [null, [], {madeUp: 1}, {thickness: NaN}, {legAWidth: '80'}, {bendRadius: Infinity}, {holesPerLeg: 2.5}, {flangeLength: 5}, {edgeMargin: 1}, {holesPerLeg: 8}, {bendRadius: 50, bendAngleDeg: 150}]) {
    assert.throws(() => normalizeParameters(input), GeometryValidationError);
  }
  assert.deepEqual(normalizeParameters({}), DEFAULT_PARAMETERS);
});
test('parameters change the mesh; exports contain actual vertices and facets', () => {
  const g = generateBracket({ legAWidth: 100 });
  assert.notDeepEqual(g.meshes.bent.positions, generateBracket().meshes.bent.positions);
  const obj = exportOBJ(g.meshes.bent), stl = exportSTL(g.meshes.bent);
  assert.equal((obj.match(/^v /gm) || []).length, g.meshes.bent.vertexCount);
  assert.equal((obj.match(/^f /gm) || []).length, g.meshes.bent.triangleCount);
  assert.equal((stl.match(/facet normal/g) || []).length, g.meshes.bent.triangleCount);
  assert.doesNotMatch(stl, /NaN|Infinity/);
});
