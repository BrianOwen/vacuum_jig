// Vacuum Jig Creator — Jig generation
//
// 1. MIN-Z heightmap via triangle rasterization (bottom surface extraction)
// 2. Euclidean Distance Transform (EDT) for groove placement
// 3. Jig mesh assembly (top surface + groove + base + walls)

import * as THREE from 'three';

const MAX_GRID_CELLS = 4_000_000;

// ---------------------------------------------------------------------------
// Step 1: MIN-Z Heightmap
// ---------------------------------------------------------------------------

/**
 * Generate a MIN-Z heightmap by rasterizing mesh triangles from below.
 * For each XY grid cell, records the lowest Z value from any triangle.
 * This captures the bottom surface of the part.
 *
 * @param {THREE.Object3D} meshGroup - The oriented model group
 * @param {number} resolution - Grid cell size (inches)
 * @param {number} margin - Extra margin around part footprint (inches)
 * @param {function} [onProgress] - Optional callback(percent)
 * @returns {Promise<Object>} heightmap descriptor
 */
export async function generateMinZHeightmap(meshGroup, resolution, margin, onProgress) {
  meshGroup.updateMatrixWorld(true);

  // Collect triangles (transformed by world matrix)
  const triangles = [];
  const _v = new THREE.Vector3();
  meshGroup.traverse(child => {
    if (!child.isMesh) return;
    const geom = child.geometry;
    const pos = geom.attributes.position;
    const idx = geom.index;
    const mat = child.matrixWorld;

    const triCount = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3)     : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

      _v.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0)).applyMatrix4(mat);
      triangles.push(_v.x, _v.y, _v.z);
      _v.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1)).applyMatrix4(mat);
      triangles.push(_v.x, _v.y, _v.z);
      _v.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2)).applyMatrix4(mat);
      triangles.push(_v.x, _v.y, _v.z);
    }
  });

  const numTris = triangles.length / 9;

  if (numTris === 0) {
    return {
      minZ: new Float32Array(4), cols: 2, rows: 2,
      globalMinZ: 0, globalMaxZ: 0,
      startX: 0, startY: 0, width: 1, height: 1,
      hitMask: new Uint8Array(4),
    };
  }

  // Bounding box with margin
  const bbox = new THREE.Box3().setFromObject(meshGroup, true);
  bbox.min.x -= margin;
  bbox.max.x += margin;
  bbox.min.y -= margin;
  bbox.max.y += margin;

  const bboxSize = bbox.getSize(new THREE.Vector3());
  const width = bboxSize.x;
  const height = bboxSize.y;

  let cols = Math.max(2, Math.ceil(width / resolution) + 1);
  let rows = Math.max(2, Math.ceil(height / resolution) + 1);

  if (cols * rows > MAX_GRID_CELLS) {
    const scale = Math.sqrt(MAX_GRID_CELLS / (cols * rows));
    cols = Math.max(2, Math.floor(cols * scale));
    rows = Math.max(2, Math.floor(rows * scale));
    console.warn(`Heightmap capped to ${cols}x${rows}`);
  }

  const dx = width / (cols - 1);
  const dy = height / (rows - 1);
  const startX = bbox.min.x;
  const startY = bbox.min.y;

  console.log(`MIN-Z Heightmap: ${cols}x${rows} = ${(cols * rows).toLocaleString()} cells, ` +
    `${numTris.toLocaleString()} triangles`);

  // Initialize to +Infinity (no surface hit)
  const minZGrid = new Float32Array(cols * rows);
  minZGrid.fill(Infinity);

  // Also track which cells were hit by a triangle
  const hitMask = new Uint8Array(cols * rows);

  // Rasterize triangles — keep MIN Z per cell
  let lastYield = performance.now();

  for (let t = 0; t < numTris; t++) {
    const base = t * 9;
    const ax = triangles[base],     ay = triangles[base + 1], az = triangles[base + 2];
    const bx = triangles[base + 3], by = triangles[base + 4], bz = triangles[base + 5];
    const cx = triangles[base + 6], cy = triangles[base + 7], cz = triangles[base + 8];

    _rasterizeTriangleMinZ(minZGrid, hitMask, cols, rows, dx, dy, startX, startY,
      ax, ay, az, bx, by, bz, cx, cy, cz);

    if (!document.hidden && (t & 255) === 0) {
      const now = performance.now();
      if (now - lastYield > 50) {
        if (onProgress) onProgress(Math.round((t / numTris) * 100));
        await new Promise(r => setTimeout(r, 0));
        lastYield = performance.now();
      }
    }
  }

  // Find global min/max Z among hit cells
  let globalMinZ = Infinity;
  let globalMaxZ = -Infinity;
  for (let i = 0; i < minZGrid.length; i++) {
    if (hitMask[i]) {
      if (minZGrid[i] < globalMinZ) globalMinZ = minZGrid[i];
      if (minZGrid[i] > globalMaxZ) globalMaxZ = minZGrid[i];
    }
  }
  if (globalMinZ === Infinity) { globalMinZ = 0; globalMaxZ = 0; }

  if (onProgress) onProgress(100);

  return {
    minZ: minZGrid, cols, rows, dx, dy,
    globalMinZ, globalMaxZ,
    startX, startY, width, height,
    hitMask,
  };
}

function _rasterizeTriangleMinZ(minZGrid, hitMask, cols, rows, dx, dy, startX, startY,
                                ax, ay, az, bx, by, bz, cx, cy, cz) {
  const gxMin = Math.max(0,        Math.floor((Math.min(ax, bx, cx) - startX) / dx));
  const gxMax = Math.min(cols - 1,  Math.ceil((Math.max(ax, bx, cx) - startX) / dx));
  const gyMin = Math.max(0,        Math.floor((Math.min(ay, by, cy) - startY) / dy));
  const gyMax = Math.min(rows - 1,  Math.ceil((Math.max(ay, by, cy) - startY) / dy));

  const v0x = cx - ax, v0y = cy - ay;
  const v1x = bx - ax, v1y = by - ay;
  const denom = v0x * v1y - v1x * v0y;
  if (Math.abs(denom) < 1e-20) return;
  const invDenom = 1 / denom;

  for (let gy = gyMin; gy <= gyMax; gy++) {
    const py = startY + gy * dy;
    const v2y = py - ay;
    const row = gy * cols;

    for (let gx = gxMin; gx <= gxMax; gx++) {
      const px = startX + gx * dx;
      const v2x = px - ax;

      const u = (v2x * v1y - v1x * v2y) * invDenom;
      const v = (v0x * v2y - v2x * v0y) * invDenom;

      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) {
        const z = az + u * (cz - az) + v * (bz - az);
        const idx = row + gx;
        if (z < minZGrid[idx]) minZGrid[idx] = z;
        hitMask[idx] = 1;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Step 2: Euclidean Distance Transform (Meijster algorithm)
// ---------------------------------------------------------------------------

/**
 * Compute exact EDT on a binary mask.
 * Returns a Float32Array of distances (in grid cell units).
 * Multiply by cell size (dx/dy) to get physical distance.
 */
function computeEDT(mask, cols, rows) {
  const INF = cols + rows;

  // Phase 1: column-wise — compute squared distance to nearest 0-cell vertically
  const g = new Float32Array(cols * rows);

  for (let x = 0; x < cols; x++) {
    // Forward pass
    if (mask[x]) {
      g[x] = 0;
    } else {
      g[x] = INF;
    }
    for (let y = 1; y < rows; y++) {
      const idx = y * cols + x;
      if (mask[idx]) {
        g[idx] = 0;
      } else {
        g[idx] = g[(y - 1) * cols + x] + 1;
      }
    }
    // Backward pass
    for (let y = rows - 2; y >= 0; y--) {
      const idx = y * cols + x;
      const below = g[(y + 1) * cols + x] + 1;
      if (below < g[idx]) g[idx] = below;
    }
  }

  // Square the g values for EDT
  for (let i = 0; i < g.length; i++) {
    g[i] = g[i] * g[i];
  }

  // Phase 2: row-wise — exact Euclidean using parabola envelopes
  const dt = new Float32Array(cols * rows);
  const s = new Int32Array(cols);
  const t = new Int32Array(cols);

  for (let y = 0; y < rows; y++) {
    const rowOff = y * cols;

    // Build lower envelope of parabolas
    let q = 0;
    s[0] = 0;
    t[0] = -Infinity;

    for (let u = 1; u < cols; u++) {
      while (q >= 0) {
        const su = s[q];
        // Compare parabola at s[q] vs u at intersection
        const lhs = (u * u - su * su) + g[rowOff + u] - g[rowOff + su];
        const rhs = 2 * (u - su);
        if (rhs > 0 && t[q] * rhs >= lhs) {
          // Intersection of new parabola is left of t[q], pop
          q--;
        } else {
          break;
        }
      }

      if (q < 0) {
        q = 0;
        s[0] = u;
        t[0] = -Infinity;
      } else {
        const su = s[q];
        const num = (u * u - su * su) + g[rowOff + u] - g[rowOff + su];
        const den = 2 * (u - su);
        const w = Math.ceil(num / den);
        q++;
        s[q] = u;
        t[q] = w;
      }
    }

    // Scan and assign
    for (let u = cols - 1; u >= 0; u--) {
      while (q > 0 && u < t[q]) q--;
      const d = u - s[q];
      dt[rowOff + u] = d * d + g[rowOff + s[q]];
    }
  }

  // Take square root to get actual Euclidean distance
  const result = new Float32Array(cols * rows);
  for (let i = 0; i < dt.length; i++) {
    result[i] = Math.sqrt(dt[i]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Step 3: Morphological opening (erode + dilate) for corner rounding
// ---------------------------------------------------------------------------

/**
 * Morphological opening of a binary mask with a circular structuring element
 * of the given radius (in grid cells). Rounds all convex corners to >= radius.
 *
 * Opening = Dilate(Erode(mask, R), R)
 *   Erode:  keep cells where distance-to-nearest-0-cell >= R
 *   Dilate: keep cells within R of any surviving eroded cell
 */
function _morphOpen(mask, cols, rows, radiusCells) {
  // Erode: for each cell in mask, how far is it from the nearest cell NOT in mask?
  // Keep only cells where that distance >= radiusCells.
  const invertedForErode = new Uint8Array(cols * rows);
  for (let i = 0; i < mask.length; i++) {
    invertedForErode[i] = mask[i] ? 0 : 1;
  }
  const distFromOutside = computeEDT(invertedForErode, cols, rows);

  const eroded = new Uint8Array(cols * rows);
  for (let i = 0; i < eroded.length; i++) {
    eroded[i] = distFromOutside[i] >= radiusCells ? 1 : 0;
  }

  // Dilate: for each cell, how far is it from the nearest eroded cell?
  // Keep cells where that distance <= radiusCells.
  const distFromEroded = computeEDT(eroded, cols, rows);

  const opened = new Uint8Array(cols * rows);
  for (let i = 0; i < opened.length; i++) {
    opened[i] = distFromEroded[i] <= radiusCells ? 1 : 0;
  }

  return opened;
}

// ---------------------------------------------------------------------------
// Step 4: Generate Jig Mesh
// ---------------------------------------------------------------------------

/**
 * Build a complete jig mesh: top surface (mating + groove + flat), base, and walls.
 *
 * @param {Object} hm - Heightmap from generateMinZHeightmap()
 * @param {Object} params - Jig parameters including groove settings and minRadius
 * @returns {{ geometry: THREE.BufferGeometry, stats: Object }}
 */
export function generateJigMesh(hm, params) {
  const { minZ: minZGrid, cols, rows, dx, dy, startX, startY, width, height,
          hitMask, globalMinZ, globalMaxZ } = hm;
  const { wallMargin, baseThickness, grooveWidth, grooveDepth, grooveOffset, minRadius, vacuum, rim } = params;
  const { holeDiameter, holeSpacing, channelDepth, channelHeight, portDiameter } = vacuum || {};
  const holeRadius = (holeDiameter || 0.1875) / 2;
  const rimEnabled = rim && rim.enabled;
  const rimHeight = (rim && rim.height) || 0.25;
  const rimThickness = (rim && rim.thickness) || 0.1875;
  const rimGap = (rim && rim.gap) || 0;

  // Compute inward EDT: distance from boundary INTO the part footprint.
  // Invert the mask so EDT measures distance from non-part cells.
  const invertedMask = new Uint8Array(cols * rows);
  for (let i = 0; i < invertedMask.length; i++) {
    invertedMask[i] = hitMask[i] ? 0 : 1;
  }
  const inwardDist = computeEDT(invertedMask, cols, rows);

  const cellSize = (dx + dy) / 2;
  const n = cols * rows;

  // Build groove mask using morphological opening to round corners.
  //
  // The groove sits between two iso-contours of the inward distance field:
  //   outer boundary: inwardDist = grooveOffset
  //   inner boundary: inwardDist = grooveOffset + grooveWidth
  //
  // Sharp corners in the part perimeter create sharp ridges in the distance
  // field, giving the groove sharp corners. Morphological opening (erode then
  // dilate by minRadius) on each boundary mask rounds all convex corners
  // to at least minRadius.
  //
  // Opening(M, R):
  //   1. Erode: keep cells where distance-to-outside-of-M >= R
  //   2. Dilate: keep cells within R of any surviving eroded cell

  const grooveOuter = new Uint8Array(n); // cells at least grooveOffset from edge
  const grooveInner = new Uint8Array(n); // cells past the groove (interior)

  const offsetCells = grooveOffset / cellSize;
  const innerCells = (grooveOffset + grooveWidth) / cellSize;

  for (let i = 0; i < n; i++) {
    if (hitMask[i]) {
      if (inwardDist[i] >= offsetCells) grooveOuter[i] = 1;
      if (inwardDist[i] >= innerCells)  grooveInner[i] = 1;
    }
  }

  const minRadCells = (minRadius || 0) / cellSize;
  let openedOuter = grooveOuter;
  let openedInner = grooveInner;

  if (minRadCells > 0) {
    openedOuter = _morphOpen(grooveOuter, cols, rows, minRadCells);
    openedInner = _morphOpen(grooveInner, cols, rows, minRadCells);
  }

  // -----------------------------------------------------------------------
  // Vacuum hole placement
  // -----------------------------------------------------------------------

  // Compute bounding box of the openedInner region (interior inside gasket)
  let innerMinCol = cols, innerMaxCol = 0, innerMinRow = rows, innerMaxRow = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (openedInner[r * cols + c]) {
        if (c < innerMinCol) innerMinCol = c;
        if (c > innerMaxCol) innerMaxCol = c;
        if (r < innerMinRow) innerMinRow = r;
        if (r > innerMaxRow) innerMaxRow = r;
      }
    }
  }

  const spacing = holeSpacing || 2.0;
  const holePositions = []; // [{wx, wy, col, row}] world coords + grid indices

  // Compute distance from each interior cell to the openedInner boundary
  // (i.e., distance to the nearest groove edge). Used to enforce clearance.
  const invertedInnerForDist = new Uint8Array(n);
  for (let i = 0; i < n; i++) invertedInnerForDist[i] = openedInner[i] ? 0 : 1;
  const distFromGroove = computeEDT(invertedInnerForDist, cols, rows);

  // Minimum clearance from hole edge to groove: 0.5"
  // Hole center must be at least (0.5 + holeRadius) from groove boundary
  const grooveClearance = 0.5;
  const centerClearanceCells = (grooveClearance + holeRadius) / cellSize;

  if (innerMaxCol >= innerMinCol && innerMaxRow >= innerMinRow) {
    // Center of the interior bounding box in world coords
    const innerCenterWX = startX + ((innerMinCol + innerMaxCol) / 2) * dx;
    const innerCenterWY = startY + ((innerMinRow + innerMaxRow) / 2) * dy;

    // Grid extents in world coords
    const innerExtentX = (innerMaxCol - innerMinCol) * dx;
    const innerExtentY = (innerMaxRow - innerMinRow) * dy;

    // Place holes on a regular grid centered on the interior
    const halfExtX = innerExtentX / 2;
    const halfExtY = innerExtentY / 2;

    // Determine grid range
    const nxHalf = Math.floor(halfExtX / spacing);
    const nyHalf = Math.floor(halfExtY / spacing);

    for (let iy = -nyHalf; iy <= nyHalf; iy++) {
      for (let ix = -nxHalf; ix <= nxHalf; ix++) {
        const wx = innerCenterWX + ix * spacing;
        const wy = innerCenterWY + iy * spacing;

        // Convert to grid indices
        const gc = Math.round((wx - startX) / dx);
        const gr = Math.round((wy - startY) / dy);

        if (gc < 0 || gc >= cols || gr < 0 || gr >= rows) continue;

        const gridIdx = gr * cols + gc;

        // Must be inside openedInner AND at least 0.5" from groove edge
        if (openedInner[gridIdx] && distFromGroove[gridIdx] >= centerClearanceCells) {
          holePositions.push({ wx, wy, col: gc, row: gr });
        }
      }
    }

    // Fallback: if no holes passed clearance, place one at the center of the interior
    if (holePositions.length === 0) {
      const gc = Math.round((innerMinCol + innerMaxCol) / 2);
      const gr = Math.round((innerMinRow + innerMaxRow) / 2);
      holePositions.push({
        wx: innerCenterWX, wy: innerCenterWY, col: gc, row: gr,
      });
    }
  }

  // Build a hole mask: grid cells within holeRadius of any hole center
  // These cells get depressed to channelZ on the top surface
  const holeRadiusCells = holeRadius / cellSize;
  const holeRadiusCellsSq = holeRadiusCells * holeRadiusCells;
  const holeMask = new Uint8Array(n); // 1 = inside a vacuum hole

  for (const hp of holePositions) {
    const cMin = Math.max(0, Math.floor(hp.col - holeRadiusCells - 1));
    const cMax = Math.min(cols - 1, Math.ceil(hp.col + holeRadiusCells + 1));
    const rMin = Math.max(0, Math.floor(hp.row - holeRadiusCells - 1));
    const rMax = Math.min(rows - 1, Math.ceil(hp.row + holeRadiusCells + 1));

    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        const dcol = c - hp.col;
        const drow = r - hp.row;
        if (dcol * dcol + drow * drow <= holeRadiusCellsSq) {
          holeMask[r * cols + c] = 1;
        }
      }
    }
  }

  // The jig top surface is at the model's bottom Z
  const flatTopZ = globalMaxZ;

  // Plenum Z positions — ceiling must clear below the groove bottom
  const cDepth = channelDepth || 0.25;
  const cHeight = channelHeight || 0.1875;
  const portR = (portDiameter || 0.375) / 2;
  const grooveBottomZ = globalMinZ - grooveDepth;
  const channelZ = grooveBottomZ - cDepth;      // plenum ceiling, cDepth below groove bottom
  const plenumFloorZ = channelZ - cHeight;       // plenum floor
  const portCenterZ = channelZ - cHeight / 2;    // port centered vertically in plenum
  const portBottomZ = portCenterZ - portR;

  // Base must enclose all internal features (plenum floor, port bottom)
  const minInternalZ = Math.min(plenumFloorZ, portBottomZ);
  const baseZ = Math.min(globalMinZ - baseThickness, minInternalZ - 0.125);

  // -----------------------------------------------------------------------
  // Mounting holes — 4 counterbored slotted holes near corners
  // Sized for M6 or 1/4-20 SHCS, slotted for 1.5" / 40mm t-slot pitch
  // -----------------------------------------------------------------------

  const mountThroughR = 0.281 / 2;   // through-hole radius (clears M6 & 1/4-20)
  const mountCbR = 0.4375 / 2;       // counterbore radius (clears both SHCS heads)
  const mountCbDepth = 0.3125;        // counterbore depth (sinks both heads)
  const mountCornerInset = Math.max(mountCbR + 0.1, (wallMargin || 0.75) / 2);
  const mountCbBotZ = flatTopZ - mountCbDepth;

  // Corner chamfer — 45° cut at each corner, sized to clear mounting holes
  const chamferSize = mountCornerInset;

  const jigCenterX = startX + width / 2;
  const jigCenterY = startY + height / 2;

  // X spacing: nearest multiple of 1.5" that fits in jig width
  const mountAvailX = width - 2 * mountCornerInset;
  const mountNPitches = Math.max(1, Math.round(mountAvailX / 1.5));
  const mountXHalf = (mountNPitches * 1.5) / 2;

  // Slot elongation to accommodate 40mm pitch alternative
  const mountSlotTotal = mountNPitches * (40 / 25.4 - 1.5); // inches
  const mountSlotHalf = mountSlotTotal / 2;

  // Y positions: inset from jig edges
  const mountYHalf = Math.max(0, height / 2 - mountCornerInset);

  const mountingHoles = [
    { x: jigCenterX - mountXHalf, y: jigCenterY - mountYHalf },
    { x: jigCenterX + mountXHalf, y: jigCenterY - mountYHalf },
    { x: jigCenterX - mountXHalf, y: jigCenterY + mountYHalf },
    { x: jigCenterX + mountXHalf, y: jigCenterY + mountYHalf },
  ];

  // -----------------------------------------------------------------------
  // Rim mask — optional band around the part perimeter for lateral holding
  // -----------------------------------------------------------------------

  const rimTopZ = flatTopZ + rimHeight;
  let rimMask = null;
  if (rimEnabled) {
    // Distance from each cell to the nearest part cell (hitMask=1)
    const outwardDist = computeEDT(hitMask, cols, rows);
    const rimGapCells = rimGap / cellSize;
    const rimThicknessCells = rimThickness / cellSize;
    rimMask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!hitMask[i] && outwardDist[i] > rimGapCells &&
          outwardDist[i] <= rimGapCells + rimThicknessCells) {
        rimMask[i] = 1;
      }
    }
  }

  // Build top surface PlaneGeometry
  const topGeom = new THREE.PlaneGeometry(width, height, cols - 1, rows - 1);
  const topPositions = topGeom.attributes.position;
  const vertexCount = topPositions.count;
  const topColors = new Float32Array(vertexCount * 3);

  // Zone classification arrays (for stats)
  let matingCells = 0, grooveCells = 0, outerCells = 0, vacuumHoleCells = 0;

  for (let i = 0; i < vertexCount; i++) {
    const col = i % cols;
    const planeRow = Math.floor(i / cols);
    const row = (rows - 1) - planeRow; // PlaneGeometry Y is flipped
    const gridIdx = row * cols + col;

    const isHit = hitMask[gridIdx];
    const isGroove = openedOuter[gridIdx] && !openedInner[gridIdx] && isHit;
    const isHole = holeMask[gridIdx] && openedInner[gridIdx];

    const wx = startX + col * dx;
    const wy = startY + row * dy;

    // Chamfer check (absolute highest priority — no material at cut corners)
    const chamfered =
      (wx - startX) + (wy - startY) < chamferSize ||
      (startX + width - wx) + (wy - startY) < chamferSize ||
      (wx - startX) + (startY + height - wy) < chamferSize ||
      (startX + width - wx) + (startY + height - wy) < chamferSize;

    // Mounting hole check
    let isMountCB = false, isMountThru = false;
    if (!chamfered) {
      for (const mh of mountingHoles) {
        const nearX = Math.max(mh.x - mountSlotHalf, Math.min(mh.x + mountSlotHalf, wx));
        const ddx = wx - nearX, ddy = wy - mh.y;
        const distSq = ddx * ddx + ddy * ddy;
        if (distSq <= mountCbR * mountCbR) {
          isMountCB = true;
          if (distSq <= mountThroughR * mountThroughR) isMountThru = true;
          break;
        }
      }
    }

    let z, r, g, b;

    if (chamfered) {
      z = baseZ;
      r = 0.55; g = 0.55; b = 0.55;
    } else if (isMountThru) {
      // Through-hole — all the way to base
      z = baseZ;
      r = 0.25; g = 0.25; b = 0.28;
    } else if (isMountCB) {
      // Counterbore pocket
      z = mountCbBotZ;
      r = 0.35; g = 0.35; b = 0.38;
    } else if (rimMask && rimMask[gridIdx]) {
      // Rim — raised wall around part perimeter for lateral holding
      z = rimTopZ;
      r = 0.65; g = 0.5; b = 0.35; // warm bronze
    } else if (isHole) {
      // Vacuum hole — depress to plenum ceiling depth
      z = channelZ;
      r = 0.15; g = 0.35; b = 0.35; // dark teal
      vacuumHoleCells++;
    } else if (isGroove) {
      // Groove zone — rounded corners via morphological opening
      z = minZGrid[gridIdx] - grooveDepth;
      r = 0.3; g = 0.3; b = 0.32; // dark gray
      grooveCells++;
    } else if (isHit) {
      // Mating surface — part bottom (edge lip + interior)
      z = minZGrid[gridIdx];
      r = 0.83; g = 0.66; b = 0.38; // warm tan
      matingCells++;
    } else {
      // Outside part footprint — flat top
      z = flatTopZ;
      r = 0.7; g = 0.78; b = 0.85; // light blue-gray
      outerCells++;
    }

    topPositions.setZ(i, z);
    topColors[i * 3] = r;
    topColors[i * 3 + 1] = g;
    topColors[i * 3 + 2] = b;
  }

  topGeom.setAttribute('color', new THREE.BufferAttribute(topColors, 3));
  topGeom.computeVertexNormals();

  // Position the top surface centered on XY
  const centerX = startX + width / 2;
  const centerY = startY + height / 2;

  // Build complete jig geometry: top surface + bottom + 4 walls
  const allPositions = [];
  const allNormals = [];
  const allColors = [];
  const allIndices = [];

  // -- Top surface --
  const topPos = topGeom.attributes.position.array;
  const topNorm = topGeom.attributes.normal.array;
  const topCol = topGeom.attributes.color.array;
  const topIdx = topGeom.index.array;

  // Offset positions by centerX, centerY
  for (let i = 0; i < topPos.length; i += 3) {
    allPositions.push(topPos[i] + centerX, topPos[i + 1] + centerY, topPos[i + 2]);
    allNormals.push(topNorm[i], topNorm[i + 1], topNorm[i + 2]);
    allColors.push(topCol[i], topCol[i + 1], topCol[i + 2]);
  }
  for (let i = 0; i < topIdx.length; i++) {
    allIndices.push(topIdx[i]);
  }

  const topVertCount = vertexCount;

  // -- Bottom surface (flat plane at baseZ) --
  const bottomGeom = new THREE.PlaneGeometry(width, height, 1, 1);
  const bottomPos = bottomGeom.attributes.position.array;
  const baseOffset = allPositions.length / 3;

  // Bottom plane — 4 corners
  const halfW = width / 2;
  const halfH = height / 2;
  const bottomVerts = [
    [centerX - halfW, centerY - halfH, baseZ],
    [centerX + halfW, centerY - halfH, baseZ],
    [centerX + halfW, centerY + halfH, baseZ],
    [centerX - halfW, centerY + halfH, baseZ],
  ];
  const bottomColor = [0.55, 0.55, 0.55]; // neutral gray

  for (const v of bottomVerts) {
    allPositions.push(v[0], v[1], v[2]);
    allNormals.push(0, 0, -1);
    allColors.push(bottomColor[0], bottomColor[1], bottomColor[2]);
  }

  // Two triangles for bottom (winding for outward normal pointing down)
  allIndices.push(
    baseOffset + 0, baseOffset + 2, baseOffset + 1,
    baseOffset + 0, baseOffset + 3, baseOffset + 2,
  );

  // -- Side walls --
  // Each wall connects the top surface edge to the base plane
  // We'll create 4 walls: front (Y-min), back (Y+max), left (X-min), right (X+max)

  const wallColor = [0.55, 0.55, 0.55];

  // Helper: add a wall strip connecting top edge vertices to base Z
  function addWall(edgeIndices, normalX, normalY) {
    const wallBase = allPositions.length / 3;

    for (let i = 0; i < edgeIndices.length; i++) {
      const topI = edgeIndices[i];
      const tx = allPositions[topI * 3];
      const ty = allPositions[topI * 3 + 1];
      const tz = allPositions[topI * 3 + 2];

      // Top vertex (copy of edge vertex)
      allPositions.push(tx, ty, tz);
      allNormals.push(normalX, normalY, 0);
      allColors.push(wallColor[0], wallColor[1], wallColor[2]);

      // Bottom vertex (same XY, base Z)
      allPositions.push(tx, ty, baseZ);
      allNormals.push(normalX, normalY, 0);
      allColors.push(wallColor[0], wallColor[1], wallColor[2]);
    }

    // Create quads between consecutive edge pairs
    for (let i = 0; i < edgeIndices.length - 1; i++) {
      const a = wallBase + i * 2;      // top current
      const b = wallBase + i * 2 + 1;  // bottom current
      const c = wallBase + (i + 1) * 2;     // top next
      const d = wallBase + (i + 1) * 2 + 1; // bottom next

      allIndices.push(a, b, c);
      allIndices.push(c, b, d);
    }
  }

  // Front edge (row=0 in PlaneGeometry = Y-min, corresponds to planeRow = rows-1)
  // PlaneGeometry vertex layout: row 0 is Y+max, row (rows-1) is Y-min
  const frontEdge = [];
  for (let c = 0; c < cols; c++) {
    frontEdge.push((rows - 1) * cols + c);
  }
  addWall(frontEdge, 0, -1);

  // Back edge (planeRow = 0 = Y+max)
  const backEdge = [];
  for (let c = 0; c < cols; c++) {
    backEdge.push(c);
  }
  addWall(backEdge, 0, 1);

  // Left edge (col=0)
  const leftEdge = [];
  for (let r = 0; r < rows; r++) {
    leftEdge.push(r * cols);
  }
  addWall(leftEdge, -1, 0);

  // Right edge (col=cols-1)
  const rightEdge = [];
  for (let r = 0; r < rows; r++) {
    rightEdge.push(r * cols + (cols - 1));
  }
  addWall(rightEdge, 1, 0);

  // -- Chamfer walls (4 diagonal faces at cut corners) --
  const cn = 1 / Math.SQRT2;
  const xMin = startX, xMax = startX + width, yMin = startY, yMax = startY + height;

  function addChamferWall(x1, y1, x2, y2, nx, ny) {
    const base = allPositions.length / 3;
    allPositions.push(x1, y1, flatTopZ);
    allPositions.push(x1, y1, baseZ);
    allPositions.push(x2, y2, flatTopZ);
    allPositions.push(x2, y2, baseZ);
    for (let i = 0; i < 4; i++) {
      allNormals.push(nx, ny, 0);
      allColors.push(wallColor[0], wallColor[1], wallColor[2]);
    }
    allIndices.push(base, base + 1, base + 2);
    allIndices.push(base + 2, base + 1, base + 3);
  }

  // Edge directions chosen so (edge × down) = outward normal
  addChamferWall(xMin + chamferSize, yMin, xMin, yMin + chamferSize, -cn, -cn);
  addChamferWall(xMax, yMin + chamferSize, xMax - chamferSize, yMin,  cn, -cn);
  addChamferWall(xMin, yMax - chamferSize, xMin + chamferSize, yMax, -cn,  cn);
  addChamferWall(xMax - chamferSize, yMax, xMax, yMax - chamferSize,  cn,  cn);

  // -----------------------------------------------------------------------
  // Vacuum plumbing geometry
  // -----------------------------------------------------------------------

  if (holePositions.length > 0) {
    const CYL_SEGS = 16;
    const tealColor = [0.15, 0.35, 0.35];
    const lightTealColor = [0.2, 0.42, 0.42];

    // -- A. Plenum cavity floor and perimeter walls --
    // The plenum is the interior region (openedInner) as a flat plane at plenumFloorZ,
    // with perimeter walls connecting it up to channelZ.

    // Find the perimeter cells of openedInner: cells in openedInner that have at
    // least one neighbor NOT in openedInner.
    const perimeterCells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (!openedInner[idx]) continue;
        // Check 4-connected neighbors
        const hasOutside =
          (c === 0 || !openedInner[idx - 1]) ||
          (c === cols - 1 || !openedInner[idx + 1]) ||
          (r === 0 || !openedInner[(r - 1) * cols + c]) ||
          (r === rows - 1 || !openedInner[(r + 1) * cols + c]);
        if (hasOutside) perimeterCells.push({ c, r });
      }
    }

    // Plenum floor plane: triangulated using the openedInner mask
    // Build a grid of vertices for interior cells, then triangulate
    // For simplicity, use the same grid approach as the top surface
    // but only emit triangles for cells where all 3 vertices are inside openedInner
    {
      const floorBase = allPositions.length / 3;

      // Add floor vertices for the full grid but only triangles for interior
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const wx = startX + c * dx;
          const wy = startY + r * dy;
          allPositions.push(wx, wy, plenumFloorZ);
          allNormals.push(0, 0, -1); // normal pointing down (into cavity)
          allColors.push(tealColor[0], tealColor[1], tealColor[2]);
        }
      }

      // Add triangles only where all vertices are inside openedInner
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const i00 = r * cols + c;
          const i10 = r * cols + (c + 1);
          const i01 = (r + 1) * cols + c;
          const i11 = (r + 1) * cols + (c + 1);

          // Only add if all 4 corners are inside openedInner
          if (openedInner[i00] && openedInner[i10] && openedInner[i01] && openedInner[i11]) {
            // Winding for downward-facing normal (viewed from below)
            allIndices.push(
              floorBase + i00, floorBase + i01, floorBase + i10,
            );
            allIndices.push(
              floorBase + i10, floorBase + i01, floorBase + i11,
            );
          }
        }
      }

      // Plenum perimeter walls: vertical quads from channelZ down to plenumFloorZ
      // around the perimeter of the openedInner region
      // For each perimeter cell, check which edges face outward and add a wall quad
      for (const pc of perimeterCells) {
        const idx = pc.r * cols + pc.c;
        const wx = startX + pc.c * dx;
        const wy = startY + pc.r * dy;

        // Check each direction: if neighbor is outside, add a wall face on that side
        // Left edge (c-1 is outside)
        if (pc.c === 0 || !openedInner[idx - 1]) {
          const wallBase = allPositions.length / 3;
          const x = wx - dx / 2;
          // Four corners of the wall quad
          allPositions.push(x, wy - dy / 2, channelZ);
          allPositions.push(x, wy + dy / 2, channelZ);
          allPositions.push(x, wy + dy / 2, plenumFloorZ);
          allPositions.push(x, wy - dy / 2, plenumFloorZ);
          for (let i = 0; i < 4; i++) {
            allNormals.push(-1, 0, 0);
            allColors.push(tealColor[0], tealColor[1], tealColor[2]);
          }
          allIndices.push(wallBase, wallBase + 1, wallBase + 2);
          allIndices.push(wallBase, wallBase + 2, wallBase + 3);
        }

        // Right edge (c+1 is outside)
        if (pc.c === cols - 1 || !openedInner[idx + 1]) {
          const wallBase = allPositions.length / 3;
          const x = wx + dx / 2;
          allPositions.push(x, wy + dy / 2, channelZ);
          allPositions.push(x, wy - dy / 2, channelZ);
          allPositions.push(x, wy - dy / 2, plenumFloorZ);
          allPositions.push(x, wy + dy / 2, plenumFloorZ);
          for (let i = 0; i < 4; i++) {
            allNormals.push(1, 0, 0);
            allColors.push(tealColor[0], tealColor[1], tealColor[2]);
          }
          allIndices.push(wallBase, wallBase + 1, wallBase + 2);
          allIndices.push(wallBase, wallBase + 2, wallBase + 3);
        }

        // Front edge (r-1 is outside, Y-min)
        if (pc.r === 0 || !openedInner[(pc.r - 1) * cols + pc.c]) {
          const wallBase = allPositions.length / 3;
          const y = wy - dy / 2;
          allPositions.push(wx + dx / 2, y, channelZ);
          allPositions.push(wx - dx / 2, y, channelZ);
          allPositions.push(wx - dx / 2, y, plenumFloorZ);
          allPositions.push(wx + dx / 2, y, plenumFloorZ);
          for (let i = 0; i < 4; i++) {
            allNormals.push(0, -1, 0);
            allColors.push(tealColor[0], tealColor[1], tealColor[2]);
          }
          allIndices.push(wallBase, wallBase + 1, wallBase + 2);
          allIndices.push(wallBase, wallBase + 2, wallBase + 3);
        }

        // Back edge (r+1 is outside, Y+max)
        if (pc.r === rows - 1 || !openedInner[(pc.r + 1) * cols + pc.c]) {
          const wallBase = allPositions.length / 3;
          const y = wy + dy / 2;
          allPositions.push(wx - dx / 2, y, channelZ);
          allPositions.push(wx + dx / 2, y, channelZ);
          allPositions.push(wx + dx / 2, y, plenumFloorZ);
          allPositions.push(wx - dx / 2, y, plenumFloorZ);
          for (let i = 0; i < 4; i++) {
            allNormals.push(0, 1, 0);
            allColors.push(tealColor[0], tealColor[1], tealColor[2]);
          }
          allIndices.push(wallBase, wallBase + 1, wallBase + 2);
          allIndices.push(wallBase, wallBase + 2, wallBase + 3);
        }
      }
    }

    // -- B. Vertical cylinder walls for each vacuum hole --
    // Each hole is a cylinder from the mating surface Z down to channelZ (plenum ceiling)
    for (const hp of holePositions) {
      const cylBase = allPositions.length / 3;
      const matingZ = minZGrid[hp.row * cols + hp.col];
      const topZ = matingZ;  // top of cylinder = mating surface
      const botZ = channelZ; // bottom of cylinder = plenum ceiling

      // Generate cylinder ring vertices (top and bottom rings)
      for (let s = 0; s <= CYL_SEGS; s++) {
        const theta = (s / CYL_SEGS) * Math.PI * 2;
        const nx = Math.cos(theta);
        const ny = Math.sin(theta);
        const cx = hp.wx + nx * holeRadius;
        const cy = hp.wy + ny * holeRadius;

        // Top ring vertex
        allPositions.push(cx, cy, topZ);
        allNormals.push(-nx, -ny, 0); // inward-facing normal (inside of hole)
        allColors.push(tealColor[0], tealColor[1], tealColor[2]);

        // Bottom ring vertex
        allPositions.push(cx, cy, botZ);
        allNormals.push(-nx, -ny, 0);
        allColors.push(tealColor[0], tealColor[1], tealColor[2]);
      }

      // Cylinder wall quads
      for (let s = 0; s < CYL_SEGS; s++) {
        const a = cylBase + s * 2;       // top current
        const b = cylBase + s * 2 + 1;   // bottom current
        const c = cylBase + (s + 1) * 2;      // top next
        const d = cylBase + (s + 1) * 2 + 1;  // bottom next

        allIndices.push(a, c, b);
        allIndices.push(b, c, d);
      }
    }

    // -- C. Horizontal port cylinder (from plenum to X-min wall) --
    // Port runs along X-axis from the interior boundary to the jig outer wall
    const jigXMin = startX; // outer wall X position
    // Find the leftmost interior cell (innerMinCol) for the port start
    const portInnerX = startX + innerMinCol * dx;

    // Port cylinder: from portInnerX to jigXMin (going left through the wall)
    {
      const cylBase = allPositions.length / 3;

      // Generate two rings: one at portInnerX (inside plenum), one at jigXMin (outer wall)
      for (let s = 0; s <= CYL_SEGS; s++) {
        const theta = (s / CYL_SEGS) * Math.PI * 2;
        const ny = Math.cos(theta);
        const nz = Math.sin(theta);
        const cy = centerY + ny * portR;
        const cz = portCenterZ + nz * portR;

        // Inner ring (at plenum boundary)
        allPositions.push(portInnerX, cy, cz);
        allNormals.push(0, -ny, -nz); // inward normal
        allColors.push(tealColor[0], tealColor[1], tealColor[2]);

        // Outer ring (at wall face)
        allPositions.push(jigXMin, cy, cz);
        allNormals.push(0, -ny, -nz);
        allColors.push(tealColor[0], tealColor[1], tealColor[2]);
      }

      // Cylinder wall quads
      for (let s = 0; s < CYL_SEGS; s++) {
        const a = cylBase + s * 2;       // inner current
        const b = cylBase + s * 2 + 1;   // outer current
        const c = cylBase + (s + 1) * 2;      // inner next
        const d = cylBase + (s + 1) * 2 + 1;  // outer next

        allIndices.push(a, b, c);
        allIndices.push(c, b, d);
      }
    }

    // -- D. Port nub (cylindrical protrusion extending from outer wall) --
    {
      const nubLength = portR * 2; // nub length = port diameter
      const nubOuterX = jigXMin - nubLength;
      const cylBase = allPositions.length / 3;

      for (let s = 0; s <= CYL_SEGS; s++) {
        const theta = (s / CYL_SEGS) * Math.PI * 2;
        const ny = Math.cos(theta);
        const nz = Math.sin(theta);
        const cy = centerY + ny * portR;
        const cz = portCenterZ + nz * portR;

        // Wall face ring
        allPositions.push(jigXMin, cy, cz);
        allNormals.push(0, ny, nz); // outward normal for external surface
        allColors.push(lightTealColor[0], lightTealColor[1], lightTealColor[2]);

        // Outer tip ring
        allPositions.push(nubOuterX, cy, cz);
        allNormals.push(0, ny, nz);
        allColors.push(lightTealColor[0], lightTealColor[1], lightTealColor[2]);
      }

      // Nub wall quads
      for (let s = 0; s < CYL_SEGS; s++) {
        const a = cylBase + s * 2;
        const b = cylBase + s * 2 + 1;
        const c = cylBase + (s + 1) * 2;
        const d = cylBase + (s + 1) * 2 + 1;

        allIndices.push(a, c, b);
        allIndices.push(b, c, d);
      }

      // Nub end cap (flat circle at nubOuterX)
      const capCenter = allPositions.length / 3;
      allPositions.push(nubOuterX, centerY, portCenterZ);
      allNormals.push(-1, 0, 0);
      allColors.push(lightTealColor[0], lightTealColor[1], lightTealColor[2]);

      for (let s = 0; s <= CYL_SEGS; s++) {
        const theta = (s / CYL_SEGS) * Math.PI * 2;
        const ny = Math.cos(theta);
        const nz = Math.sin(theta);
        allPositions.push(nubOuterX, centerY + ny * portR, portCenterZ + nz * portR);
        allNormals.push(-1, 0, 0);
        allColors.push(lightTealColor[0], lightTealColor[1], lightTealColor[2]);
      }

      for (let s = 0; s < CYL_SEGS; s++) {
        allIndices.push(capCenter, capCenter + 1 + s + 1, capCenter + 1 + s);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Mounting hole wall geometry
  // -----------------------------------------------------------------------

  {
    const MOUNT_SEGS = 24;
    const mountColor = [0.35, 0.35, 0.38];

    // Generate stadium perimeter points (closed loop)
    function stadiumPerimeter(cx, cy, radius, hSlot, nSegs) {
      const pts = [];
      const half = Math.floor(nSegs / 2);
      // Right semicircle (bottom to top)
      for (let s = 0; s <= half; s++) {
        const th = -Math.PI / 2 + (s / half) * Math.PI;
        const ct = Math.cos(th), st = Math.sin(th);
        pts.push({ x: cx + hSlot + radius * ct, y: cy + radius * st, nx: ct, ny: st });
      }
      // Left semicircle (top to bottom)
      for (let s = 1; s < half; s++) {
        const th = Math.PI / 2 + (s / half) * Math.PI;
        const ct = Math.cos(th), st = Math.sin(th);
        pts.push({ x: cx - hSlot + radius * ct, y: cy + radius * st, nx: ct, ny: st });
      }
      // Close: add bottom-left point (connects back to bottom-right via bottom edge)
      pts.push({ x: cx - hSlot, y: cy - radius, nx: 0, ny: -1 });
      return pts;
    }

    // Add stadium-shaped cylinder wall (closed loop of quads)
    function addStadiumWall(cx, cy, radius, hSlot, topZ, botZ) {
      const pts = stadiumPerimeter(cx, cy, radius, hSlot, MOUNT_SEGS);
      const base = allPositions.length / 3;
      for (const p of pts) {
        // Top ring vertex
        allPositions.push(p.x, p.y, topZ);
        allNormals.push(-p.nx, -p.ny, 0); // inward normal
        allColors.push(mountColor[0], mountColor[1], mountColor[2]);
        // Bottom ring vertex
        allPositions.push(p.x, p.y, botZ);
        allNormals.push(-p.nx, -p.ny, 0);
        allColors.push(mountColor[0], mountColor[1], mountColor[2]);
      }
      const nPts = pts.length;
      for (let i = 0; i < nPts; i++) {
        const next = (i + 1) % nPts;
        const a = base + i * 2, b = base + i * 2 + 1;
        const c = base + next * 2, d = base + next * 2 + 1;
        allIndices.push(a, c, b);
        allIndices.push(b, c, d);
      }
      return pts;
    }

    for (const mh of mountingHoles) {
      // A. Counterbore wall (from flatTopZ down to mountCbBotZ)
      addStadiumWall(mh.x, mh.y, mountCbR, mountSlotHalf, flatTopZ, mountCbBotZ);

      // B. Through-hole wall (from mountCbBotZ down to baseZ)
      addStadiumWall(mh.x, mh.y, mountThroughR, mountSlotHalf, mountCbBotZ, baseZ);

      // C. Counterbore ledge (annular ring between CB and through-hole at mountCbBotZ)
      const cbPts = stadiumPerimeter(mh.x, mh.y, mountCbR, mountSlotHalf, MOUNT_SEGS);
      const thPts = stadiumPerimeter(mh.x, mh.y, mountThroughR, mountSlotHalf, MOUNT_SEGS);
      const ledgeBase = allPositions.length / 3;
      const nPts = cbPts.length;

      // Outer ring (CB perimeter) at ledge Z
      for (const p of cbPts) {
        allPositions.push(p.x, p.y, mountCbBotZ);
        allNormals.push(0, 0, 1); // upward into counterbore
        allColors.push(mountColor[0], mountColor[1], mountColor[2]);
      }
      // Inner ring (through-hole perimeter) at ledge Z
      for (const p of thPts) {
        allPositions.push(p.x, p.y, mountCbBotZ);
        allNormals.push(0, 0, 1);
        allColors.push(mountColor[0], mountColor[1], mountColor[2]);
      }
      // Connect outer to inner with quads
      for (let i = 0; i < nPts; i++) {
        const next = (i + 1) % nPts;
        const outerI = ledgeBase + i;
        const outerNext = ledgeBase + next;
        const innerI = ledgeBase + nPts + i;
        const innerNext = ledgeBase + nPts + next;
        allIndices.push(outerI, innerI, outerNext);
        allIndices.push(outerNext, innerI, innerNext);
      }
    }
  }

  // Assemble final geometry
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(allNormals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(allColors, 3));
  geometry.setIndex(allIndices);

  bottomGeom.dispose();
  topGeom.dispose();

  const triCount = allIndices.length / 3;

  return {
    geometry,
    stats: {
      cols, rows,
      width: width.toFixed(3),
      height: height.toFixed(3),
      depth: (flatTopZ - baseZ).toFixed(3),
      triangles: triCount,
      matingCells,
      grooveCells,
      outerCells,
      vacuumHoles: holePositions.length,
      mountingHoles: mountingHoles.length,
      mountingPitches: mountNPitches,
    },
  };
}
