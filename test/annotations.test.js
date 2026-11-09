import test from 'node:test';
import assert from 'node:assert/strict';
import { quadBoxes, textUnder } from '../web/src/annotext.js';

const item = (str, x, y, width) => ({ str, width, height: 9, transform: [9, 0, 0, 9, x, y] });

test('a highlight takes only the words under its box', () => {
  // One run of 40 characters, 200 points wide: 5 points per character.
  const items = [item('Standard errors are Newey-West with lags', 100, 500, 200), item('next line text here', 100, 488, 95)];
  const boxes = quadBoxes({ quadPoints: new Float32Array([200, 509, 255, 509, 200, 499, 255, 499]) });
  assert.deepEqual(boxes, [[200, 499, 255, 509]]);
  assert.equal(textUnder(items, boxes), 'Newey-West');
  // Two quads over two lines.
  const two = quadBoxes({ quadPoints: [200, 509, 300, 509, 200, 499, 300, 499, 100, 497, 140, 497, 100, 487, 140, 487] });
  assert.equal(textUnder(items, two), 'Newey-West with lags next line');
  assert.deepEqual(quadBoxes({ rect: [10, 20, 5, 30] }), [[5, 20, 10, 30]]);
});
