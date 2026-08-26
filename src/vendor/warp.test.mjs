// =========================================================================
// THE CONTRACT TEST
// =========================================================================
// This file is the artefact that keeps two repos honest. Muralista owns
// `warp.js`; Pregonero vendors a copy of it and runs THIS SAME TEST against
// that copy. If both repos are green, the two tools agree about where every
// shape lands - which is the whole reason the warp is shared code instead of
// a second implementation.
//
// THE EXPECTED STRINGS ARE GOLDEN VALUES, not derived ones. They were taken
// from the build that was verified at a real projector, so they encode a
// warp that is known to sit flush on a physical wall. A change to any of
// them is not a test failure to be fixed by updating the string: it means
// every room ever mapped now renders somewhere else. If that is genuinely
// intended, say why in `warp-contract.md` in the same commit.
//
// String equality is the right assertion and not a brittle one. Every
// operation in the module is IEEE-754 double arithmetic with no
// transcendentals, and ECMAScript specifies Number-to-string exactly, so a
// conforming engine cannot produce a different string for the same inputs.
// The float noise visible in the 1024x768 case (-7.105427357601004e-18) is
// deliberately pinned for that reason - it is the fingerprint of this exact
// elimination order, and reordering the arithmetic would move it.
//
// Run it with no dependencies and no build step:
//
//   node --test mapper/warp.test.mjs
//
// Node 22.7 or newer, which reads `warp.js` as an ES module by syntax
// detection. There is no package.json here and there should not be one:
// `warp.js` is one file that a browser <script type="module"> and a Vite
// build both take as-is, and adding a manifest to make a test runner happy
// would be the build pipeline this module exists to avoid.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  frameMatrix3d,
  computeHomography,
  homographyToMatrix3dString,
  applyHomography,
  UNIT_SQUARE_CORNERS,
  UNIT_SIZE,
} from "./warp.js";

// Corner order is [top-left, top-right, bottom-right, bottom-left]
// throughout, matching surface.corners everywhere in Muralista.
const FRAME_MATRIX_CASES = [
  {
    name: "full frame maps the unit box onto the whole output",
    frame: [[0, 0], [1, 0], [1, 1], [0, 1]],
    w: 1920,
    h: 1080,
    expected: "matrix3d(1.92,0,0,0,0,1.08,0,0,0,0,1,0,0,0,0,1)",
  },
  {
    name: "centred inset rectangle is a scale plus a translation",
    frame: [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]],
    w: 1920,
    h: 1080,
    expected: "matrix3d(0.96,0,0,0,0,0.54,0,0,0,0,1,0,480,270,0,1)",
  },
  {
    name: "keystone trapezoid at 1920x1080",
    frame: [[0.2, 0.1], [0.8, 0.1], [0.95, 0.9], [0.05, 0.9]],
    w: 1920,
    h: 1080,
    expected:
      "matrix3d(1.152,0,0,0,-0.32,0.54,0,-0.0003333333333333333,0,0,1,0,384,108,0,1)",
  },
  {
    name: "the same keystone at 3840x2160",
    frame: [[0.2, 0.1], [0.8, 0.1], [0.95, 0.9], [0.05, 0.9]],
    w: 3840,
    h: 2160,
    expected:
      "matrix3d(2.304,0,0,0,-0.64,1.08,0,-0.0003333333333333333,0,0,1,0,768,216,0,1)",
  },
  {
    name: "the same keystone at 1024x768, an off-16:9 projector",
    frame: [[0.2, 0.1], [0.8, 0.1], [0.95, 0.9], [0.05, 0.9]],
    w: 1024,
    h: 768,
    expected:
      "matrix3d(0.6144,-7.105427357601004e-18,0,-9.251858538542972e-20,-0.1706666666666667,0.3840000000000001,0,-0.00033333333333333327,0,0,1,0,204.8,76.80000000000001,0,1)",
  },
  {
    name: "arbitrary skew at 1280x800",
    frame: [[0.1, 0.2], [0.85, 0.05], [0.9, 0.8], [0.15, 0.95]],
    w: 1280,
    h: 800,
    expected:
      "matrix3d(0.96,-0.12,0,0,0.064,0.6,0,0,0,0,1,0,128,160,0,1)",
  },
  {
    name: "corners overshooting the output frame, which Muralista allows",
    frame: [[-0.1, -0.05], [1.2, 0.02], [1.05, 1.1], [-0.2, 0.9]],
    w: 1920,
    h: 1080,
    expected:
      "matrix3d(2.208,0.0729,0,-0.00012500000000000008,-0.2016,1.0503,0,0.00002499999999999999,0,0,1,0,-192,-54,0,1)",
  },
];

for (const { name, frame, w, h, expected } of FRAME_MATRIX_CASES) {
  test(`frameMatrix3d: ${name}`, () => {
    assert.equal(frameMatrix3d(frame, w, h), expected);
  });
}

// The single most important assertion in this file. The corners are
// normalized and resolution-independent; the matrix is not. Freeze a matrix
// into visuals.json and the venue's projector puts the lyrics half onto the
// brick, with nothing crashing and nothing warning. Save the recipe, not the
// cake.
test("frameMatrix3d: the same corners give a different matrix at a different output size", () => {
  const frame = [[0.2, 0.1], [0.8, 0.1], [0.95, 0.9], [0.05, 0.9]];
  assert.notEqual(frameMatrix3d(frame, 1920, 1080), frameMatrix3d(frame, 3840, 2160));
});

test("frameMatrix3d: degenerate and missing frames return null rather than a wrong matrix", () => {
  // Three collinear corners have no homography; the caller skips the render.
  assert.equal(frameMatrix3d([[0, 0], [0.5, 0.5], [1, 1], [0.25, 0.25]], 1920, 1080), null);
  assert.equal(frameMatrix3d([[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]], 1920, 1080), null);
  assert.equal(frameMatrix3d(null, 1920, 1080), null);
});

test("homographyToMatrix3dString: CSS column-major order, z passthrough, perspective row", () => {
  const h = { h0: 1, h1: 2, h2: 3, h3: 4, h4: 5, h5: 6, h6: 7, h7: 8 };
  assert.equal(
    homographyToMatrix3dString(h),
    "matrix3d(1,4,0,7,2,5,0,8,0,0,1,0,3,6,0,1)",
  );
});

// How the camera calibration uses the module: an arbitrary quad seen by the
// camera is mapped onto the normalized output frame, and contour points are
// carried through it by hand because there is no element to hang a CSS
// transform on.
test("computeHomography + applyHomography: a camera quad lands on the unit square", () => {
  const cameraQuad = [[0.12, 0.08], [0.88, 0.14], [0.83, 0.92], [0.09, 0.86]];
  const H = computeHomography(cameraQuad, UNIT_SQUARE_CORNERS);
  assert.ok(H);
  cameraQuad.forEach((corner, i) => {
    const [x, y] = applyHomography(H, corner);
    assert.ok(Math.abs(x - UNIT_SQUARE_CORNERS[i][0]) < 1e-12);
    assert.ok(Math.abs(y - UNIT_SQUARE_CORNERS[i][1]) < 1e-12);
  });
  assert.deepEqual(applyHomography(H, [0.48, 0.5]), [0.5005109053721116, 0.4933605581551584]);
});

test("computeHomography: degenerate corners return null", () => {
  assert.equal(
    computeHomography(UNIT_SQUARE_CORNERS, [[0, 0], [0.5, 0.5], [1, 1], [0.25, 0.25]]),
    null,
  );
});

test("applyHomography: a point on the horizon returns null instead of Infinity", () => {
  // w = h6*x + h7*y + 1 is exactly 0 here.
  assert.equal(applyHomography({ h0: 1, h1: 0, h2: 0, h3: 0, h4: 1, h5: 0, h6: -1, h7: 0 }, [1, 0]), null);
});

test("the constants are what every caller draws against", () => {
  assert.equal(UNIT_SIZE, 1000);
  assert.deepEqual(UNIT_SQUARE_CORNERS, [[0, 0], [1, 0], [1, 1], [0, 1]]);
});

// The purity rule, as far as a test can reach it: same inputs give the same
// answer whatever ran before, and nothing the caller handed in comes back
// changed. What a test CANNOT reach - that no caller caches a matrix, and
// that content is drawn into the unit box first - is why the contract is
// also written down in prose.
test("purity: no state between calls, and arguments are never mutated", () => {
  const frame = [[0.2, 0.1], [0.8, 0.1], [0.95, 0.9], [0.05, 0.9]];
  const before = JSON.stringify(frame);

  const first = frameMatrix3d(frame, 1920, 1080);
  frameMatrix3d([[0, 0], [1, 0], [1, 1], [0, 1]], 640, 480);
  frameMatrix3d(frame, 1024, 768);
  const again = frameMatrix3d(frame, 1920, 1080);

  assert.equal(again, first);
  assert.equal(JSON.stringify(frame), before);

  const src = UNIT_SQUARE_CORNERS.map((p) => p.slice());
  const dst = [[10, 20], [110, 25], [105, 130], [15, 120]];
  const srcBefore = JSON.stringify(src);
  const dstBefore = JSON.stringify(dst);
  computeHomography(src, dst);
  assert.equal(JSON.stringify(src), srcBefore);
  assert.equal(JSON.stringify(dst), dstBefore);
});

// Importing at all under Node is the assertion: there is no document, no
// window and no globalThis state to lean on, so a module that touched any of
// them would have thrown before the first test ran.
test("no DOM, no globals: the module loads in a runtime that has neither", () => {
  assert.equal(typeof globalThis.document, "undefined");
  assert.equal(typeof globalThis.window, "undefined");
});
