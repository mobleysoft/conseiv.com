// Conseiv Designer: a self-serve parametric brand/SVG asset generator.
//
// This extends the studio's real parametric-CAD approach (shared/geometry.js:
// validated numeric parameters -> deterministic geometric construction ->
// a generated artifact, with limitations disclosed in metadata) from 3D
// sheet-metal bracket meshes to 2D brand marks. Same philosophy, new domain:
// no canned clipart, no image-generation model call, no randomness dressed
// up as design. A brand name is hashed to a deterministic seed so the same
// inputs always produce the same mark, and that seed drives real geometric
// rules (polygon side count, star points, corner rounding, spike angle).

export const GENERATOR_VERSION = 1;

export const STYLES = Object.freeze(['geometric', 'rounded', 'sharp']);

export const DEFAULT_PARAMETERS = Object.freeze({
  name: 'Conseiv',
  primaryColor: '#1d4ed8',
  secondaryColor: '#f97316',
  style: 'geometric',
});

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const NAME_PATTERN = /^[\p{L}\p{N} .,&'!_-]{1,40}$/u;

export class DesignerValidationError extends Error {
  constructor(fields) {
    super(Object.values(fields).join(' '));
    this.name = 'DesignerValidationError';
    this.fields = fields;
  }
}

export function normalizeBrandParameters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DesignerValidationError({ parameters: 'Parameters must be an object.' });
  }
  const fields = {};
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(DEFAULT_PARAMETERS, key)) fields[key] = `Unknown parameter: ${key}.`;
  }
  const p = { ...DEFAULT_PARAMETERS, ...input };
  const trimmedName = typeof p.name === 'string' ? p.name.trim() : '';
  if (!NAME_PATTERN.test(trimmedName)) {
    fields.name = "name must be 1 to 40 letters, numbers, spaces, or . , & ' ! _ - characters.";
  }
  if (typeof p.primaryColor !== 'string' || !HEX_COLOR.test(p.primaryColor)) {
    fields.primaryColor = 'primaryColor must be a 6-digit hex color, e.g. #1d4ed8.';
  }
  if (typeof p.secondaryColor !== 'string' || !HEX_COLOR.test(p.secondaryColor)) {
    fields.secondaryColor = 'secondaryColor must be a 6-digit hex color, e.g. #f97316.';
  }
  if (typeof p.style !== 'string' || !STYLES.includes(p.style)) {
    fields.style = `style must be one of: ${STYLES.join(', ')}.`;
  }
  if (Object.keys(fields).length) throw new DesignerValidationError(fields);
  return {
    name: trimmedName,
    primaryColor: p.primaryColor.toLowerCase(),
    secondaryColor: p.secondaryColor.toLowerCase(),
    style: p.style,
  };
}

// Deterministic 32-bit FNV-1a hash: the same brand name + style always
// produces the same seed, so generation is repeatable, not random noise.
function seedFrom(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function escapeXml(text) {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}

const round = (value) => Math.round(value * 1000) / 1000;

function regularPolygonPoints(sides, radius, rotation, cx, cy) {
  return Array.from({ length: sides }, (_, i) => {
    const theta = rotation + (2 * Math.PI * i) / sides;
    return [cx + radius * Math.cos(theta), cy + radius * Math.sin(theta)];
  });
}

// Builds an SVG path 'd' string through a closed polygon loop. When
// cornerRadiusRatio is set, each vertex is replaced by a quadratic-curve
// fillet sized relative to its shortest adjacent edge -- the same
// bend-relief idea shared/geometry.js applies to sheet-metal corners,
// here applied to a 2D brand mark instead of a 3D bend line.
function polygonPath(points, cornerRadiusRatio) {
  const n = points.length;
  if (!cornerRadiusRatio) {
    return `M ${points.map(([x, y]) => `${round(x)} ${round(y)}`).join(' L ')} Z`;
  }
  const corners = points.map((cur, i) => {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const toPrev = [prev[0] - cur[0], prev[1] - cur[1]];
    const toNext = [next[0] - cur[0], next[1] - cur[1]];
    const lenPrev = Math.hypot(...toPrev);
    const lenNext = Math.hypot(...toNext);
    const r = Math.min(lenPrev, lenNext) * cornerRadiusRatio;
    return {
      cur,
      enter: [cur[0] + (toPrev[0] / lenPrev) * r, cur[1] + (toPrev[1] / lenPrev) * r],
      exit: [cur[0] + (toNext[0] / lenNext) * r, cur[1] + (toNext[1] / lenNext) * r],
    };
  });
  let d = `M ${round(corners[0].enter[0])} ${round(corners[0].enter[1])} `;
  for (let i = 0; i < n; i++) {
    const corner = corners[i];
    const nextCorner = corners[(i + 1) % n];
    d += `Q ${round(corner.cur[0])} ${round(corner.cur[1])} ${round(corner.exit[0])} ${round(corner.exit[1])} `;
    d += `L ${round(nextCorner.enter[0])} ${round(nextCorner.enter[1])} `;
  }
  return `${d}Z`;
}

const MARK_CENTER = 32;
const MARK_RADIUS = 26;

// Real geometric construction rules per style, all driven by the
// deterministic seed rather than fixed/canned shapes:
//  - geometric: a star polygon (alternating outer/inner radius), 3-8 points
//  - rounded:   a regular polygon, 3-7 sides, with filleted corners
//  - sharp:     a regular polygon, 3-8 sides, with one vertex pulled outward
//               into a spike for an angular mark
function markPathFor(style, seed) {
  const sides = 3 + (seed % 6);
  const rotation = ((seed >> 3) % 360) * (Math.PI / 180);
  if (style === 'rounded') {
    const points = regularPolygonPoints(Math.max(3, sides - 1), MARK_RADIUS, rotation, MARK_CENTER, MARK_CENTER);
    return polygonPath(points, 0.32);
  }
  if (style === 'sharp') {
    const points = regularPolygonPoints(sides, MARK_RADIUS, rotation, MARK_CENTER, MARK_CENTER);
    points[0] = [MARK_CENTER + MARK_RADIUS * 1.35 * Math.cos(rotation), MARK_CENTER + MARK_RADIUS * 1.35 * Math.sin(rotation)];
    return polygonPath(points, 0);
  }
  const innerRatio = 0.42 + ((seed >> 7) % 20) / 100;
  const points = [];
  for (let i = 0; i < sides * 2; i++) {
    const theta = rotation + (Math.PI * i) / sides;
    const radius = i % 2 === 0 ? MARK_RADIUS : MARK_RADIUS * innerRatio;
    points.push([MARK_CENTER + radius * Math.cos(theta), MARK_CENTER + radius * Math.sin(theta)]);
  }
  return polygonPath(points, 0);
}

const FONT_FAMILY = "'Space Grotesk', 'IBM Plex Mono', system-ui, sans-serif";
const LETTER_SPACING = Object.freeze({ geometric: 2, rounded: 0.5, sharp: -0.5 });

export function generateBrandAsset(input = {}) {
  const parameters = normalizeBrandParameters(input);
  const seed = seedFrom(`${parameters.name.toLowerCase()}|${parameters.style}`);
  const markPath = markPathFor(parameters.style, seed);
  const fontSize = 34;
  const letterSpacing = LETTER_SPACING[parameters.style];
  const approxCharWidth = fontSize * 0.58;
  const textWidth = Math.max(60, parameters.name.length * approxCharWidth + (parameters.name.length - 1) * letterSpacing);
  const padding = 12;
  const markBoxWidth = 64;
  const gap = 16;
  const width = round(padding * 2 + markBoxWidth + gap + textWidth);
  const height = round(padding * 2 + 64);
  const textX = round(padding + markBoxWidth + gap);
  const textY = round(height / 2 + fontSize * 0.34);
  const accentIndex = seed % 3;
  const accent = accentIndex === 0
    ? `<circle cx="48" cy="16" r="5" fill="${parameters.secondaryColor}" />`
    : accentIndex === 1
      ? `<rect x="42" y="42" width="10" height="10" fill="${parameters.secondaryColor}" />`
      : '';

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(parameters.name)} logo">`,
    `<title>${escapeXml(parameters.name)}</title>`,
    `<g transform="translate(${padding} ${padding})">`,
    `<path d="${markPath}" fill="${parameters.primaryColor}" />`,
    accent,
    `</g>`,
    `<text x="${textX}" y="${textY}" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="700" letter-spacing="${letterSpacing}" fill="${parameters.primaryColor}">${escapeXml(parameters.name)}</text>`,
    `</svg>`,
  ].filter(Boolean).join('');

  return {
    generatorVersion: GENERATOR_VERSION,
    parameters,
    svg,
    metadata: {
      seed,
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      units: 'px',
      markSides: 3 + (seed % 6),
      limitations: [
        'Deterministic parametric geometry (a polygon/star mark plus a system-font wordmark), not a licensed logo design, illustration, or trademark-cleared asset.',
        'No image-generation model is used; this is rule-based 2D vector construction, the same generation philosophy the studio already uses for parametric bracket meshes, applied to a different domain.',
      ],
    },
  };
}
