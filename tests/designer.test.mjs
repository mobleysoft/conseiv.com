import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMETERS, generateBrandAsset, normalizeBrandParameters, DesignerValidationError } from '../shared/designer.js';

// Structural XML well-formedness check: balanced tags (self-closing tags
// excluded from the stack), matching close-tag names, and no stray
// unescaped ampersands. This stands in for a DOM/browser parse, which
// isn't available in this test environment.
function assertWellFormedSvg(svg) {
  assert.ok(svg.startsWith('<svg'), 'starts with <svg');
  assert.ok(svg.endsWith('</svg>'), 'ends with </svg>');
  const stack = [];
  const tagPattern = /<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/)?>/g;
  let match;
  while ((match = tagPattern.exec(svg))) {
    const [, closing, name, selfClose] = match;
    if (closing) {
      assert.equal(stack.pop(), name, `mismatched closing tag ${name}`);
    } else if (!selfClose) {
      stack.push(name);
    }
  }
  assert.equal(stack.length, 0, 'every opened tag is closed');
  assert.doesNotMatch(svg, /&(?!amp;|lt;|gt;|quot;|apos;|#)/, 'no unescaped ampersand');
}

test('default brand parameters generate a deterministic, well-formed SVG', () => {
  const a = generateBrandAsset();
  const b = generateBrandAsset();
  assert.deepEqual(a, b);
  assertWellFormedSvg(a.svg);
  assert.match(a.svg, /<svg[^>]*viewBox="0 0 \d+(\.\d+)? \d+(\.\d+)?"/);
  assert.match(a.svg, /<text[^>]*>Conseiv<\/text>/);
  assert.equal(a.parameters.style, 'geometric');
});

test('rejects malformed, unknown, and out-of-range parameters', () => {
  for (const input of [
    null, [], { madeUp: 1 }, { name: '' }, { name: '   ' }, { name: 'x'.repeat(41) },
    { primaryColor: 'blue' }, { primaryColor: '#zzzzzz' }, { primaryColor: '#fff' },
    { secondaryColor: 123 }, { style: 'bubbly' }, { style: 42 },
  ]) {
    assert.throws(() => normalizeBrandParameters(input), DesignerValidationError);
  }
  assert.deepEqual(normalizeBrandParameters({}), DEFAULT_PARAMETERS);
});

test('different names and styles produce distinct, still well-formed marks', () => {
  const names = ['Acme Robotics', 'Zephyr Labs', 'Nimbus Freight'];
  const styles = ['geometric', 'rounded', 'sharp'];
  const seen = new Set();
  for (const name of names) {
    for (const style of styles) {
      const design = generateBrandAsset({ name, style, primaryColor: '#112233', secondaryColor: '#aa4400' });
      assertWellFormedSvg(design.svg);
      assert.ok(design.svg.includes(`>${name}<`));
      assert.ok(design.svg.includes('#112233'), 'primary color is used');
      seen.add(design.svg);
    }
  }
  assert.equal(seen.size, names.length * styles.length, 'every name/style combination yields distinct geometry');
});

test('secondaryColor is actually used as an accent for at least some inputs', () => {
  const used = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'].some((name) =>
    generateBrandAsset({ name, secondaryColor: '#00ffaa' }).svg.includes('#00ffaa'));
  assert.ok(used, 'secondaryColor shows up in at least one generated accent');
});

test('the same name and style always produces the same mark (deterministic, not random)', () => {
  const first = generateBrandAsset({ name: 'Repeatable Co', style: 'rounded' });
  const second = generateBrandAsset({ name: 'Repeatable Co', style: 'rounded' });
  assert.deepEqual(first, second);
});

test('special characters in brand names are escaped, not injected', () => {
  const design = generateBrandAsset({ name: "Zephyr & Co" });
  assert.match(design.svg, /Zephyr &amp; Co/);
  assert.doesNotMatch(design.svg, /<script/i);
  assertWellFormedSvg(design.svg);

  const apostrophe = generateBrandAsset({ name: "O'Brien Labs" });
  assert.match(apostrophe.svg, /O&apos;Brien Labs/);
  assertWellFormedSvg(apostrophe.svg);
});
