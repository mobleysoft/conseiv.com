import { ShapeUtils, Vector2 } from 'three';

export const GENERATOR_VERSION = 1;
export const DEFAULT_PARAMETERS = Object.freeze({
  legAWidth: 80,
  legBWidth: 60,
  flangeLength: 40,
  thickness: 3,
  bendRadius: 4,
  kFactor: 0.44,
  holeDiameter: 6,
  holesPerLeg: 2,
  edgeMargin: 12,
  bendAngleDeg: 90,
});

export const PARAMETER_LIMITS = Object.freeze({
  legAWidth: Object.freeze({ min: 10, max: 500 }),
  legBWidth: Object.freeze({ min: 10, max: 500 }),
  flangeLength: Object.freeze({ min: 5, max: 300 }),
  thickness: Object.freeze({ min: 0.5, max: 12 }),
  bendRadius: Object.freeze({ min: 0.5, max: 50 }),
  kFactor: Object.freeze({ min: 0.2, max: 0.5 }),
  holeDiameter: Object.freeze({ min: 1, max: 50 }),
  holesPerLeg: Object.freeze({ min: 0, max: 8, integer: true }),
  edgeMargin: Object.freeze({ min: 1, max: 100 }),
  bendAngleDeg: Object.freeze({ min: 15, max: 150 }),
});

export class GeometryValidationError extends Error {
  constructor(fields) {
    super(Object.values(fields).join(' '));
    this.name = 'GeometryValidationError';
    this.fields = fields;
  }
}

export function normalizeParameters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new GeometryValidationError({ parameters: 'Parameters must be an object.' });
  }
  const fields = {};
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(DEFAULT_PARAMETERS, key)) fields[key] = `Unknown parameter: ${key}.`;
  }
  const p = { ...DEFAULT_PARAMETERS, ...input };
  for (const [key, range] of Object.entries(PARAMETER_LIMITS)) {
    const value = p[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < range.min || value > range.max || (range.integer && !Number.isInteger(value))) {
      fields[key] = `${key} must be ${range.integer ? 'an integer' : 'a finite number'} from ${range.min} to ${range.max}.`;
    }
  }
  if (Object.keys(fields).length) throw new GeometryValidationError(fields);
  const setback = (p.bendRadius + p.thickness) * Math.tan(p.bendAngleDeg * Math.PI / 360);
  for (const key of ['legAWidth', 'legBWidth']) {
    const straight = p[key] - setback;
    if (straight < 1) {
      fields[key] = `${key} must leave at least 1 mm of straight leg after the bend setback.`;
    } else if (p.holesPerLeg > 0 && straight < 2 * p.edgeMargin) {
      fields[key] = `${key} leaves insufficient straight length for the hole-center margins.`;
    } else if (p.holesPerLeg > 1 && (straight - 2 * p.edgeMargin) / (p.holesPerLeg - 1) < p.holeDiameter + 0.5) {
      fields[key] = `${key} must leave at least 0.5 mm between adjacent holes.`;
    }
  }
  if (p.holesPerLeg > 0) {
    if (p.edgeMargin < p.holeDiameter / 2 + 0.5) fields.edgeMargin = 'Hole edges must clear straight-leg ends and the bend by at least 0.5 mm.';
    if (p.flangeLength < p.holeDiameter + 1) fields.flangeLength = 'Hole edges must clear both flange sides by at least 0.5 mm.';
  }
  if (Object.keys(fields).length) throw new GeometryValidationError(fields);
  return p;
}

const HOLE_SEGMENTS = 48;

function meshBounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  return { min, max };
}

export function generateBracket(input = {}) {
  const parameters = normalizeParameters(input);
  const p = parameters;
  const angle = p.bendAngleDeg * Math.PI / 180;
  const outsideSetback = (p.bendRadius + p.thickness) * Math.tan(angle / 2);
  const legAFlat = p.legAWidth - outsideSetback;
  const legBFlat = p.legBWidth - outsideSetback;
  const bendAllowance = angle * (p.bendRadius + p.kFactor * p.thickness);
  const bendEnd = legAFlat + bendAllowance;
  const totalFlatLength = bendEnd + legBFlat;
  const bendSegments = Math.ceil(p.bendAngleDeg / 3);

  // z=0 is the outer sheet face. The neutral axis is at (1-K)*thickness.
  function bendPoint(x, y, z) {
    if (x <= legAFlat) return [x, y, z];
    const radius = p.bendRadius + p.thickness - z;
    const theta = Math.min(angle, (x - legAFlat) / (p.bendRadius + p.kFactor * p.thickness));
    const tail = Math.max(0, x - bendEnd);
    return [
      legAFlat + radius * Math.sin(theta) + tail * Math.cos(angle),
      y,
      p.bendRadius + p.thickness - radius * Math.cos(theta) + tail * Math.sin(angle),
    ];
  }

  const holes = [];
  for (const [leg, length, offset] of [['A', legAFlat, 0], ['B', legBFlat, bendEnd]]) {
    for (let i = 0; i < p.holesPerLeg; i++) {
      const x = offset + (p.holesPerLeg === 1 ? length / 2 : p.edgeMargin + (length - 2 * p.edgeMargin) * i / (p.holesPerLeg - 1));
      const y = p.flangeLength / 2;
      holes.push({
        leg, x, y, d: p.holeDiameter,
        bentCenter: bendPoint(x, y, p.thickness / 2),
        bentAxis: leg === 'A' ? [0, 0, 1] : [-Math.sin(angle), 0, Math.cos(angle)],
      });
    }
  }
  const rings = holes.map(hole => Array.from({ length: HOLE_SEGMENTS }, (_, i) => {
    const theta = -2 * Math.PI * i / HOLE_SEGMENTS;
    return new Vector2(hole.x + hole.d / 2 * Math.cos(theta), hole.y + hole.d / 2 * Math.sin(theta));
  }));

  const flatPositions = [];
  const indices = [];
  const vertices = new Map();
  function vertex(x, y, z) {
    const key = `${x.toFixed(9)},${y.toFixed(9)},${z.toFixed(9)}`;
    if (!vertices.has(key)) {
      vertices.set(key, flatPositions.length / 3);
      flatPositions.push(x, y, z);
    }
    return vertices.get(key);
  }
  function face(a, b, c) {
    // Earcut can choose either orientation; cap winding is made explicit here.
    if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) [b, c] = [c, b];
    indices.push(vertex(a.x, a.y, p.thickness), vertex(b.x, b.y, p.thickness), vertex(c.x, c.y, p.thickness));
    indices.push(vertex(c.x, c.y, 0), vertex(b.x, b.y, 0), vertex(a.x, a.y, 0));
  }
  function rectangle(start, end, holeRings = []) {
    const contour = [new Vector2(start, 0), new Vector2(end, 0), new Vector2(end, p.flangeLength), new Vector2(start, p.flangeLength)];
    const points = [...contour, ...holeRings.flat()];
    for (const triangle of ShapeUtils.triangulateShape(contour, holeRings)) {
      face(...triangle.map(index => points[index]));
    }
  }
  rectangle(0, legAFlat, rings.slice(0, p.holesPerLeg));
  rectangle(bendEnd, totalFlatLength, rings.slice(p.holesPerLeg));
  const stations = [0, legAFlat];
  for (let i = 0; i < bendSegments; i++) {
    const start = legAFlat + bendAllowance * i / bendSegments;
    const end = legAFlat + bendAllowance * (i + 1) / bendSegments;
    rectangle(start, end);
    stations.push(end);
  }
  stations.push(totalFlatLength);
  const perimeter = [
    ...stations.map(x => new Vector2(x, 0)),
    ...stations.toReversed().map(x => new Vector2(x, p.flangeLength)),
  ];
  // The contour is counterclockwise and holes clockwise, so right-facing walls
  // close both the outer perimeter and the bores without internal duplicate faces.
  for (const loop of [perimeter, ...rings]) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const a0 = vertex(a.x, a.y, 0);
      const b0 = vertex(b.x, b.y, 0);
      const a1 = vertex(a.x, a.y, p.thickness);
      const b1 = vertex(b.x, b.y, p.thickness);
      indices.push(a0, b0, b1, a0, b1, a1);
    }
  }
  const bentPositions = [];
  for (let i = 0; i < flatPositions.length; i += 3) {
    bentPositions.push(...bendPoint(...flatPositions.slice(i, i + 3)));
  }
  const pack = positions => ({ positions, indices: [...indices], vertexCount: positions.length / 3, triangleCount: indices.length / 3, bounds: meshBounds(positions) });
  return {
    generatorVersion: GENERATOR_VERSION,
    parameters,
    meshes: { bent: pack(bentPositions), flat: pack(flatPositions) },
    metadata: {
      units: 'mm',
      coordinateSystem: 'Right-handed XYZ; flat in XY, thickness +Z; bend axis Y, leg B rises in +Z.',
      dimensionConvention: 'Outside virtual-sharp leg dimensions; bendAngleDeg is rotation from flat.',
      bendAllowance, outsideSetback, legAFlat, legBFlat, totalFlatLength,
      bendLineX: legAFlat + bendAllowance / 2,
      outline: { width: totalFlatLength, height: p.flangeLength },
      holeCount: holes.length, holes, holeSegments: HOLE_SEGMENTS, bendSegments,
      limitations: [
        'Tessellated parametric geometry; holes and bend arcs are polygonal approximations.',
        'Bend allowance uses the supplied K-factor; confirm tooling, material, tolerances, and bend compensation before fabrication.',
        'No load analysis, structural certification, or manufacturing approval is provided.',
      ],
    },
  };
}

const numberText = value => Number(value.toFixed(9)).toString();

export function exportOBJ(mesh) {
  const lines = ['# Conseiv mounting bracket; coordinates in millimeters', 'o conseiv_bracket'];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    lines.push(`v ${mesh.positions.slice(i, i + 3).map(numberText).join(' ')}`);
  }
  for (let i = 0; i < mesh.indices.length; i += 3) {
    lines.push(`f ${mesh.indices.slice(i, i + 3).map(index => index + 1).join(' ')}`);
  }
  return `${lines.join('\n')}\n`;
}

export function exportSTL(mesh) {
  const lines = ['solid conseiv_bracket_mm'];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices.slice(i, i + 3).map(index => mesh.positions.slice(index * 3, index * 3 + 3));
    const u = b.map((value, axis) => value - a[axis]);
    const v = c.map((value, axis) => value - a[axis]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n);
    lines.push(`  facet normal ${n.map(value => numberText(value / length)).join(' ')}`, '    outer loop');
    for (const point of [a, b, c]) lines.push(`      vertex ${point.map(numberText).join(' ')}`);
    lines.push('    endloop', '  endfacet');
  }
  lines.push('endsolid conseiv_bracket_mm');
  return `${lines.join('\n')}\n`;
}

export function exportDXF(generation) {
  const meta = generation.metadata;
  const lines = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LWPOLYLINE', '8', '0', '90', '4', '70', '1',
    '10', '0.0', '20', '0.0',
    '10', numberText(meta.outline.width), '20', '0.0',
    '10', numberText(meta.outline.width), '20', numberText(meta.outline.height),
    '10', '0.0', '20', numberText(meta.outline.height),
  ];
  for (const h of meta.holes) {
    lines.push(
      '0', 'CIRCLE', '8', '0',
      '10', numberText(h.x), '20', numberText(h.y), '40', numberText(h.d / 2)
    );
  }
  const bY1 = '0.0';
  const bY2 = numberText(meta.outline.height);
  lines.push(
    '0', 'LINE', '8', 'BEND',
    '10', numberText(meta.legAFlat), '20', bY1, '11', numberText(meta.legAFlat), '21', bY2,
    '0', 'LINE', '8', 'BEND',
    '10', numberText(meta.legAFlat + meta.bendAllowance), '20', bY1, '11', numberText(meta.legAFlat + meta.bendAllowance), '21', bY2,
    '0', 'LINE', '8', 'BEND_CENTER',
    '10', numberText(meta.bendLineX), '20', bY1, '11', numberText(meta.bendLineX), '21', bY2,
    '0', 'ENDSEC', '0', 'EOF'
  );
  return `${lines.join('\n')}\n`;
}
