// Vacuum Jig Creator — Main entry point
// Wires UI events to model loading, jig generation, preview, and export

import * as THREE from 'three';
import { state, setStatus, setLoading } from './state.js';
import { loadFile, orientModel, calculateBoundingBox } from './modules/model-loader.js';
import { generateMinZHeightmap, generateJigMesh } from './modules/jig-gen.js';
import { initThreeScene, showModel, showJig, fitCamera, clearScene, syncThemeColors } from './modules/preview.js';
import { exportSTL } from './modules/export.js';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const modelInfo = document.getElementById('modelInfo');
const modelFileName = document.getElementById('modelFileName');
const modelSize = document.getElementById('modelSize');
const orientationSelect = document.getElementById('orientationSelect');

const wallMarginInput = document.getElementById('wallMargin');
const baseThicknessInput = document.getElementById('baseThickness');
const resolutionInput = document.getElementById('resolution');
const grooveWidthInput = document.getElementById('grooveWidth');
const grooveDepthInput = document.getElementById('grooveDepth');
const grooveOffsetInput = document.getElementById('grooveOffset');
const minRadiusInput = document.getElementById('minRadius');

const holeDiameterInput = document.getElementById('holeDiameter');
const holeSpacingInput = document.getElementById('holeSpacing');
const channelDepthInput = document.getElementById('channelDepth');
const channelHeightInput = document.getElementById('channelHeight');
const portDiameterInput = document.getElementById('portDiameter');

const rimEnabledInput = document.getElementById('rimEnabled');
const rimHeightInput = document.getElementById('rimHeight');
const rimThicknessInput = document.getElementById('rimThickness');
const rimGapInput = document.getElementById('rimGap');

const generateBtn = document.getElementById('generateBtn');
const exportStlBtn = document.getElementById('exportStlBtn');
const jigInfo = document.getElementById('jigInfo');
const jigSize = document.getElementById('jigSize');
const jigGrid = document.getElementById('jigGrid');
const jigTriangles = document.getElementById('jigTriangles');

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

initThreeScene();

// Sync Three.js scene on theme change
new MutationObserver(() => syncThemeColors())
  .observe(document.body, { attributes: true, attributeFilter: ['class'] });

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});

async function handleFile(file) {
  try {
    setLoading(true, 'Loading model...');
    setStatus('Loading ' + file.name + '...');

    const { group, bounds, wasMetric } = await loadFile(file);

    state.model.group = group;
    state.model.fileName = file.name;
    state.model.loaded = true;

    // Apply current orientation
    applyOrientation();

    // Show model info
    modelFileName.textContent = file.name;
    modelInfo.classList.remove('hidden');

    generateBtn.disabled = false;

    setStatus('Model loaded — ' + file.name + (wasMetric ? ' (converted from mm)' : ''));
  } catch (err) {
    setStatus('Error: ' + err.message);
    console.error(err);
  } finally {
    setLoading(false);
  }
}

// ---------------------------------------------------------------------------
// Orientation
// ---------------------------------------------------------------------------

orientationSelect.addEventListener('change', () => {
  if (!state.model.loaded) return;
  applyOrientation();
});

function applyOrientation() {
  const orientation = orientationSelect.value;
  state.model.orientation = orientation;

  const oriented = orientModel(state.model.group, orientation);
  state.model.orientedGroup = oriented;

  // Compute bounds after orientation
  const bounds = calculateBoundingBox(oriented);
  state.model.bounds = bounds;

  // Update size display
  const s = bounds.size;
  modelSize.textContent = `${s.x.toFixed(3)} × ${s.y.toFixed(3)} × ${s.z.toFixed(3)} in`;

  // Show the model in preview
  clearScene();
  showModel(oriented);

  // Clear any previous generation
  state.generated.heightmap = null;
  state.generated.jigGeometry = null;
  state.generated.jigMesh = null;
  exportStlBtn.disabled = true;
  jigInfo.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Jig parameter inputs
// ---------------------------------------------------------------------------

wallMarginInput.addEventListener('change', () => {
  state.jig.wallMargin = parseFloat(wallMarginInput.value) || 0.75;
});

baseThicknessInput.addEventListener('change', () => {
  state.jig.baseThickness = parseFloat(baseThicknessInput.value) || 0.5;
});

resolutionInput.addEventListener('change', () => {
  state.jig.resolution = parseFloat(resolutionInput.value) || 0.02;
});

grooveWidthInput.addEventListener('change', () => {
  state.jig.grooveWidth = parseFloat(grooveWidthInput.value) || 0.25;
});

grooveDepthInput.addEventListener('change', () => {
  state.jig.grooveDepth = parseFloat(grooveDepthInput.value) || 0.175;
});

grooveOffsetInput.addEventListener('change', () => {
  state.jig.grooveOffset = parseFloat(grooveOffsetInput.value) || 0.125;
});

minRadiusInput.addEventListener('change', () => {
  state.jig.minRadius = parseFloat(minRadiusInput.value) || 0.25;
});

holeDiameterInput.addEventListener('change', () => {
  state.jig.vacuum.holeDiameter = parseFloat(holeDiameterInput.value) || 0.1875;
});

holeSpacingInput.addEventListener('change', () => {
  state.jig.vacuum.holeSpacing = parseFloat(holeSpacingInput.value) || 2.0;
});

channelDepthInput.addEventListener('change', () => {
  state.jig.vacuum.channelDepth = parseFloat(channelDepthInput.value) || 0.25;
});

channelHeightInput.addEventListener('change', () => {
  state.jig.vacuum.channelHeight = parseFloat(channelHeightInput.value) || 0.1875;
});

portDiameterInput.addEventListener('change', () => {
  state.jig.vacuum.portDiameter = parseFloat(portDiameterInput.value) || 0.375;
});

rimEnabledInput.addEventListener('change', () => {
  state.jig.rim.enabled = rimEnabledInput.checked;
});

rimHeightInput.addEventListener('change', () => {
  state.jig.rim.height = parseFloat(rimHeightInput.value) || 0.25;
});

rimThicknessInput.addEventListener('change', () => {
  state.jig.rim.thickness = parseFloat(rimThicknessInput.value) || 0.1875;
});

rimGapInput.addEventListener('change', () => {
  state.jig.rim.gap = parseFloat(rimGapInput.value) || 0;
});

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

generateBtn.addEventListener('click', doGenerate);

async function doGenerate() {
  if (!state.model.orientedGroup) return;

  try {
    setLoading(true, 'Generating heightmap...');
    setStatus('Generating MIN-Z heightmap...');
    generateBtn.disabled = true;

    const { resolution, wallMargin, baseThickness,
            grooveWidth, grooveDepth, grooveOffset, minRadius, vacuum, rim } = state.jig;

    // Step 1: Generate MIN-Z heightmap
    const hm = await generateMinZHeightmap(
      state.model.orientedGroup,
      resolution,
      wallMargin,
      (pct) => setLoading(true, `Scanning bottom surface... ${pct}%`)
    );

    state.generated.heightmap = hm;

    // Step 2: Generate jig mesh
    setLoading(true, 'Building jig mesh...');
    setStatus('Building jig mesh...');

    const { geometry, stats } = generateJigMesh(hm, {
      wallMargin, baseThickness, grooveWidth, grooveDepth, grooveOffset, minRadius, vacuum, rim,
    });

    state.generated.jigGeometry = geometry;

    // Step 3: Show in preview
    clearScene();
    showModel(state.model.orientedGroup);
    showJig(geometry);

    const totalDepth = parseFloat(stats.depth);
    fitCamera(hm.width, hm.height, totalDepth);

    // Update info
    jigSize.textContent = `${stats.width} × ${stats.height} × ${stats.depth} in`;
    jigGrid.textContent = `${stats.cols} × ${stats.rows} (${(stats.cols * stats.rows).toLocaleString()} cells)`;
    jigTriangles.textContent = stats.triangles.toLocaleString();
    jigInfo.classList.remove('hidden');

    exportStlBtn.disabled = false;

    const vacMsg = stats.vacuumHoles ? `, vacuum holes: ${stats.vacuumHoles}` : '';
    const mountMsg = stats.mountingHoles ? `, ${stats.mountingHoles} mounting slots (${stats.mountingPitches}× pitch)` : '';
    setStatus(`Jig generated — ${stats.triangles.toLocaleString()} triangles, ` +
      `mating: ${stats.matingCells.toLocaleString()}, groove: ${stats.grooveCells.toLocaleString()}${vacMsg}${mountMsg}`);

  } catch (err) {
    setStatus('Error: ' + err.message);
    console.error(err);
  } finally {
    setLoading(false);
    generateBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

exportStlBtn.addEventListener('click', () => {
  if (!state.generated.jigGeometry) return;
  const baseName = state.model.fileName.replace(/\.[^.]+$/, '');
  exportSTL(state.generated.jigGeometry, `jig_${baseName}.stl`);
  setStatus('Exported jig_' + baseName + '.stl');
});

// ---------------------------------------------------------------------------
// Unit toggle
// ---------------------------------------------------------------------------

unitToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.unit-btn');
  if (!btn) return;
  const unit = btn.dataset.unit;
  if (unit === state.units) return;

  state.units = unit;
  unitToggle.querySelectorAll('.unit-btn').forEach(b => b.classList.toggle('active', b.dataset.unit === unit));

  // Update unit labels
  const isMetric = unit === 'mm';
  const factor = isMetric ? 25.4 : 1 / 25.4;
  const lengthLabel = isMetric ? 'mm' : 'in';

  document.querySelectorAll('[data-unit-label="length"]').forEach(el => {
    el.textContent = lengthLabel;
  });

  // Convert numeric input values
  const numericInputs = [wallMarginInput, baseThicknessInput, resolutionInput,
                         grooveWidthInput, grooveDepthInput, grooveOffsetInput,
                         minRadiusInput, holeDiameterInput, holeSpacingInput,
                         channelDepthInput, channelHeightInput, portDiameterInput,
                         rimHeightInput, rimThicknessInput, rimGapInput];
  for (const input of numericInputs) {
    const val = parseFloat(input.value);
    if (!isNaN(val)) {
      input.value = +(val * factor).toFixed(isMetric ? 2 : 4);
    }
  }
});
