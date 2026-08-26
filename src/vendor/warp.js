// =========================================================================
// WARP (homography -> CSS matrix3d)
// =========================================================================
// THE SHARED MODULE. This is the only file in Muralista that another program
// runs. Pregonero vendors a byte-identical copy of it and executes it on
// stage, because Pregonero is the only thing running there and the warp is
// still Muralista's to own. Lending the FUNCTION is how that ownership
// travels without Muralista having to be running. The alternative - a second
// implementation in Pregonero - was rejected: two understandings that must
// agree would not, and the disagreement would show up as a few pixels of
// rotation on a wall in front of people, with no way to tell which tool is
// lying. See `warp-contract.md` in the tramoya-integration vault; that
// document, not this comment, is the contract.
//
// PURITY IS THE POINT, NOT A STYLE PREFERENCE. No state held between calls,
// no I/O, no DOM, no globals, and no knowledge that Pregonero exists.
// Everything arrives as an argument and everything leaves as a return value.
// A module that satisfies that cannot carry data between two running tools,
// which is what keeps the first contract rule - the handoff carries no data -
// intact. If something here seems to need state, it belongs in a caller.
//
// THE OUTPUT SIZE IS ALWAYS A PARAMETER, NEVER A STORED VALUE. Corners are
// normalized and resolution-independent; the matrix is built in real stage
// pixels. The projector at a venue is not the display the room was mapped
// on, so a matrix frozen into visuals.json - or cached across a resize or a
// display change - renders perfectly and lands in the wrong place, with
// nothing crashing and nothing warning. Save the recipe, not the cake.
//
// WHAT A CALLER MUST GUARANTEE, none of it catchable by a test: draw content
// into the UNIT_SIZE box first, size everything as a fraction of that box
// rather than in pixels, never cache a matrix, and never edit a vendored
// copy in place - a fix lands here and is re-vendored.
//
// Pure math, no DOM. Solves the standard planar projective transform (a
// "homography") that maps 4 source points onto 4 destination points, via
// the classic Direct Linear Transform setup: each correspondence gives 2
// linear equations in the 8 unknowns h0..h7 of
//
//   H = [ h0  h1  h2 ]
//       [ h3  h4  h5 ]
//       [ h6  h7   1 ]     (h8 fixed at 1 - defined up to scale)
//
// solved with plain Gaussian elimination + partial pivoting (no libraries -
// this is a spike). Verified standalone against known square->quad cases
// (identity, translation, keystone trapezoid, arbitrary skew) by round-
// tripping through the actual matrix3d column order + perspective divide -
// that script is now `warp.test.mjs` next to this file, and it is the same
// test the consuming repo runs against its vendored copy.

function solveLinearSystem(A, b) {
  const n = A.length;
  const M = A.map((row, i) => row.concat([b[i]])); // augmented matrix, copy so we don't mutate inputs

  for (let col = 0; col < n; col++) {
    // Partial pivot: swap in the row with the largest magnitude in this
    // column, for numerical stability.
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(M[pivotRow][col]) < 1e-12) return null; // singular - degenerate corners (e.g. collinear)
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  return M.map((row, i) => row[n] / row[i]);
}

// srcCorners/dstCorners: 4 points each, [top-left, top-right, bottom-right,
// bottom-left] order (matches surface.corners everywhere in this app).
// Returns { h0..h7 } or null if the corners are degenerate (e.g. 3+ collinear).
export function computeHomography(srcCorners, dstCorners) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = srcCorners[i];
    const [X, Y] = dstCorners[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }
  const h = solveLinearSystem(A, b);
  if (!h) return null;
  const [h0, h1, h2, h3, h4, h5, h6, h7] = h;
  return { h0, h1, h2, h3, h4, h5, h6, h7 };
}

// Embeds the 3x3 homography into a 4x4 CSS matrix3d(). The standard trick:
// build a matrix that leaves z untouched (row 3 = [0,0,1,0]) and puts the
// homography's perspective row (h6,h7,0,1) into row 4, so the GPU's own
// perspective divide (x/w, y/w) after the matrix multiply reproduces the 2D
// projective transform. CSS matrix3d(...) args are column-major, so the
// rows below get transposed into columns when written out.
export function homographyToMatrix3dString(h) {
  const { h0, h1, h2, h3, h4, h5, h6, h7 } = h;
  const m = [
    h0, h3, 0, h6, // column 1
    h1, h4, 0, h7, // column 2
    0, 0, 1, 0, // column 3 (z passthrough)
    h2, h5, 0, 1, // column 4 (translation + perspective constant)
  ];
  return `matrix3d(${m.join(",")})`;
}

// Applies a homography to a single point, doing by hand the perspective
// divide the GPU does for us in homographyToMatrix3dString(). Needed because
// the shadow suggestion maps traced CONTOUR POINTS from camera space into
// output space - there is no element to hang a CSS transform on, only
// numbers. Returns null where the point lands on the horizon (w ~ 0), which
// a sane calibration never produces but a degenerate one can.
export function applyHomography(h, [x, y]) {
  const w = h.h6 * x + h.h7 * y + 1;
  if (!isFinite(w) || Math.abs(w) < 1e-12) return null;
  const px = (h.h0 * x + h.h1 * y + h.h2) / w;
  const py = (h.h3 * x + h.h4 * y + h.h5) / w;
  return isFinite(px) && isFinite(py) ? [px, py] : null;
}

// The normalized output frame, as a quad in surface.corners order. The
// camera calibration maps project.cameraQuad onto exactly this.
export const UNIT_SQUARE_CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

// The pattern/layer content is drawn into a fixed 1000x1000px "unit square"
// local coordinate space; this is the homography's source domain for every
// surface. Corner order matches surface.corners: [TL, TR, BR, BL].
export const UNIT_SIZE = 1000;
const UNIT_SRC_CORNERS = [
  [0, 0],
  [UNIT_SIZE, 0],
  [UNIT_SIZE, UNIT_SIZE],
  [0, UNIT_SIZE],
];

// Returns a matrix3d() string mapping the UNIT_SIZE content box onto a shape's
// CONTENT FRAME (its four corners), scaled into window-pixel space (w,h) - or
// null if the frame is missing or currently degenerate (caller should skip the
// render). The outline plays no part here: it clips, it does not warp.
export function frameMatrix3d(frame, w, h) {
  if (!frame) return null;
  const dstCorners = frame.map(([nx, ny]) => [nx * w, ny * h]);
  const H = computeHomography(UNIT_SRC_CORNERS, dstCorners);
  return H ? homographyToMatrix3dString(H) : null;
}
