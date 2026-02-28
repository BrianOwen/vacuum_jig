// Vacuum Jig Creator — Centralized state

export const state = {
  // Loaded 3D model
  model: {
    loaded: false,
    fileName: '',
    group: null,         // Three.js Group (original, unrotated)
    orientedGroup: null, // Three.js Group (after orientation + recentering)
    bounds: null,        // { min, max, size, center }
    orientation: 'top',  // 'top','front','right','back','left','bottom'
  },

  // Jig parameters
  jig: {
    wallMargin: 0.75,      // extra space beyond part footprint (inches)
    baseThickness: 0.5,    // solid base below mating surface (inches)
    grooveWidth: 0.25,     // gasket groove width (inches)
    grooveDepth: 0.175,    // gasket groove depth (inches)
    grooveOffset: 0.125,   // inset from part perimeter edge (inches)
    minRadius: 0.25,       // minimum corner radius for groove path (inches)
    resolution: 0.02,      // grid cell size for heightmap (inches)
    vacuum: {
      holeDiameter: 0.1875,    // 3/16" default hole diameter (inches)
      holeSpacing: 2.0,        // grid spacing between holes (inches)
      channelDepth: 0.25,      // depth of plenum below mating surface (inches)
      channelHeight: 0.1875,   // height of plenum cavity (inches)
      portDiameter: 0.375,     // side port diameter (inches)
    },
    rim: {
      enabled: false,          // off by default — useful when part has finished outer profile
      height: 0.25,            // rim height above mating surface (inches)
      thickness: 0.1875,       // rim wall thickness (inches)
      gap: 0.01,               // clearance between part edge and rim inner face (inches)
    },
  },

  // Generated data
  generated: {
    heightmap: null,       // MIN-Z surface grid
    jigGeometry: null,     // THREE.BufferGeometry of complete jig
    jigMesh: null,         // THREE.Mesh for preview
  },

  // Units
  units: 'in',

  // UI state
  statusText: 'Ready — Load an STL or STEP file to begin',
  loading: false,
};

export function setStatus(text) {
  state.statusText = text;
  const el = document.getElementById('statusText');
  if (el) el.textContent = text;
}

export function setLoading(loading, text) {
  state.loading = loading;
  const overlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');
  if (overlay) overlay.classList.toggle('hidden', !loading);
  if (loadingText && text) loadingText.textContent = text;
}
