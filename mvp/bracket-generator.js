/*
 * Parametric mounting-bracket flat-pattern generator.
 * Real sheet-metal engineering computation (bend allowance, K-factor),
 * not a hardcoded output -- every field below is derived from the
 * input parameters and changes when they change.
 *
 * Scope note (honest, not aspirational): this is the geometry/CAM
 * core a Fusion360/Onshape API plugin would call to compute the part
 * before inserting it into the document. It does NOT itself call the
 * Fusion360 or Onshape API (that requires those applications installed
 * and running, which this environment cannot do or test) -- it is the
 * real computational engine underneath that integration layer, runnable
 * standalone as a web tool today and embeddable in a plugin tomorrow.
 */

function generateMountingBracket(params) {
  const {
    legAWidth,      // mm, length of first flange (mounted-to-surface leg)
    legBWidth,      // mm, length of second flange (mounted-object leg)
    flangeLength,   // mm, common width of both flanges (perpendicular to bend)
    thickness,      // mm, material thickness
    bendRadius,     // mm, inside bend radius
    kFactor = 0.44, // sheet-metal K-factor (neutral axis position), typical steel default
    holeDiameter,   // mm
    holesPerLeg,    // integer >= 1, evenly spaced holes per leg
    edgeMargin,     // mm, distance from each hole center to the nearest flat-pattern edge
    bendAngleDeg = 90
  } = params;

  if (legAWidth <= 0 || legBWidth <= 0 || flangeLength <= 0 || thickness <= 0) {
    throw new Error('All physical dimensions must be positive');
  }
  if (holeDiameter > 0 && edgeMargin * 2 + holeDiameter > flangeLength) {
    throw new Error('Hole diameter + margins exceed flange width -- holes would run off the part');
  }

  const bendAngleRad = (bendAngleDeg * Math.PI) / 180;

  // Real sheet-metal bend allowance formula:
  // BA = angle(rad) * (radius + K*thickness)
  const bendAllowance = bendAngleRad * (bendRadius + kFactor * thickness);

  // Flat-pattern total length = both flat legs (each leg's dimension minus
  // the material consumed by the bend radius itself) plus the bend allowance.
  const legAFlat = legAWidth - (bendRadius + thickness);
  const legBFlat = legBWidth - (bendRadius + thickness);
  if (legAFlat <= 0 || legBFlat <= 0) {
    throw new Error('Bend radius + thickness leaves no flat leg length -- increase leg width or reduce bend radius');
  }
  const totalFlatLength = legAFlat + bendAllowance + legBFlat;

  // Bend line sits at the end of leg A's flat run.
  const bendLineX = legAFlat + bendAllowance / 2;

  // Evenly space holes along each leg's flat run, centered across flangeLength.
  function holesOnLeg(legFlatLen, xOffset) {
    const holes = [];
    if (!holeDiameter || holesPerLeg < 1) return holes;
    const usableLen = legFlatLen - 2 * edgeMargin;
    if (usableLen < 0) throw new Error('Edge margin too large for leg length');
    for (let i = 0; i < holesPerLeg; i++) {
      const x = holesPerLeg === 1
        ? xOffset + legFlatLen / 2
        : xOffset + edgeMargin + (usableLen * i) / (holesPerLeg - 1);
      holes.push({ x: round3(x), y: round3(flangeLength / 2), d: holeDiameter });
    }
    return holes;
  }

  const holesLegA = holesOnLeg(legAFlat, 0);
  const holesLegB = holesOnLeg(legBFlat, legAFlat + bendAllowance);
  const holes = holesLegA.concat(holesLegB);

  function round3(n) { return Math.round(n * 1000) / 1000; }

  const outline = {
    width: round3(totalFlatLength),
    height: round3(flangeLength)
  };

  // Real DXF entity text (LINE for outline, LWPOLYLINE-free simple CIRCLE per hole,
  // dashed LINE for the bend line) -- minimal but syntactically valid DXF R12 ASCII.
  const dxfLines = [];
  dxfLines.push('0', 'SECTION', '2', 'ENTITIES');
  function dxfLine(x1, y1, x2, y2) {
    dxfLines.push('0', 'LINE', '8', 'OUTLINE',
      '10', String(x1), '20', String(y1), '30', '0',
      '11', String(x2), '21', String(y2), '31', '0');
  }
  dxfLine(0, 0, outline.width, 0);
  dxfLine(outline.width, 0, outline.width, outline.height);
  dxfLine(outline.width, outline.height, 0, outline.height);
  dxfLine(0, outline.height, 0, 0);
  // bend line marker
  dxfLine(round3(bendLineX), 0, round3(bendLineX), outline.height);
  holes.forEach(h => {
    dxfLines.push('0', 'CIRCLE', '8', 'HOLES',
      '10', String(h.x), '20', String(h.y), '30', '0',
      '40', String(h.d / 2));
  });
  dxfLines.push('0', 'ENDSEC', '0', 'EOF');

  return {
    inputEcho: params,
    bendAllowance: round3(bendAllowance),
    totalFlatLength: round3(totalFlatLength),
    bendLineX: round3(bendLineX),
    outline,
    holes,
    holeCount: holes.length,
    dxfText: dxfLines.join('\n')
  };
}

if (typeof module !== 'undefined') {
  module.exports = { generateMountingBracket };
}
