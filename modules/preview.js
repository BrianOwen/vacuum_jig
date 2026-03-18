// Vacuum Jig Creator — Three.js preview
// Model display (semi-transparent) + jig mesh visualization

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let renderer, scene, camera, controls;
let modelGroup, jigMesh;

// ── Read theme tokens from CSS ──────────────────────────────
function getThemeColors() {
  const css = getComputedStyle(document.body);
  const read = (prop, fallback) => css.getPropertyValue(prop).trim() || fallback;
  const themed = read('--t-mesh-style', '') === 'themed';
  return {
    canvasBg:        read('--t-canvas-bg', '#f0f0f0'),
    themed,
    meshDefault:     read('--t-mesh-default', '#cccccc'),
    meshOpacity:     parseFloat(read('--t-mesh-opacity', '1')),
    meshEmissive:    read('--t-mesh-emissive', '#000000'),
    meshEmissiveInt: parseFloat(read('--t-mesh-emissive-intensity', '0')),
    meshEdgeColor:   read('--t-mesh-edge-color', '#333333'),
    meshEdgeOpacity: parseFloat(read('--t-mesh-edge-opacity', '1')),
    accent:          read('--t-accent', '#2090a0'),
  };
}

export function initThreeScene() {
  const canvas = document.getElementById('threeCanvas');
  const container = document.getElementById('canvasContainer');

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(getThemeColors().canvasBg);

  const aspect = container.clientWidth / container.clientHeight;
  camera = new THREE.PerspectiveCamera(45, aspect, 0.001, 1000);
  camera.position.set(0, -8, 6);
  camera.up.set(0, 0, 1);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight1.position.set(5, -5, 10);
  scene.add(dirLight1);
  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
  dirLight2.position.set(-5, 5, 5);
  scene.add(dirLight2);

  window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  animate();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function clearScene() {
  clearModel();
  clearJig();
}

function clearModel() {
  if (modelGroup) { scene.remove(modelGroup); disposeGroup(modelGroup); modelGroup = null; }
}

function clearJig() {
  if (jigMesh) { scene.remove(jigMesh); disposeGroup(jigMesh); jigMesh = null; }
}

function disposeGroup(group) {
  group.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
      else child.material.dispose();
    }
  });
}

// ---------------------------------------------------------------------------
// Show model (semi-transparent so jig is visible underneath)
// ---------------------------------------------------------------------------

export function showModel(group) {
  clearModel();
  modelGroup = group.clone(true);

  const tc = getThemeColors();
  const modelColor = tc.themed ? tc.meshDefault : '#8888cc';

  modelGroup.traverse(child => {
    if (child.isMesh) {
      child.material = child.material.clone();
      child.material.transparent = true;
      child.material.opacity = 0.35;
      child.material.depthWrite = false;
      child.material.color.set(modelColor);
      if (tc.themed) {
        child.material.emissive = new THREE.Color(tc.meshEmissive);
        child.material.emissiveIntensity = tc.meshEmissiveInt * 0.5;
      }
    }
    if (child.isLineSegments) {
      child.visible = false;
    }
  });

  scene.add(modelGroup);

  const bbox = new THREE.Box3().setFromObject(modelGroup, true);
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = maxDim * 2;

  camera.position.set(center.x, center.y - dist * 0.6, center.z + dist * 0.8);
  controls.target.set(center.x, center.y, center.z);
  controls.update();
}

// ---------------------------------------------------------------------------
// Show generated jig mesh
// ---------------------------------------------------------------------------

export function showJig(geometry) {
  clearJig();

  const tc = getThemeColors();

  const material = new THREE.MeshPhongMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    shininess: 30,
    emissive: new THREE.Color(tc.themed ? tc.meshEmissive : '#000000'),
    emissiveIntensity: tc.meshEmissiveInt,
  });

  jigMesh = new THREE.Mesh(geometry, material);

  const edges = new THREE.EdgesGeometry(geometry, 20);
  const edgeMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(tc.themed ? tc.meshEdgeColor : '#333333'),
    transparent: true,
    opacity: tc.themed ? tc.meshEdgeOpacity * 0.3 : 0.15,
  });
  jigMesh.add(new THREE.LineSegments(edges, edgeMat));

  scene.add(jigMesh);
}

// ---------------------------------------------------------------------------
// Fit camera to show both part and jig
// ---------------------------------------------------------------------------

export function fitCamera(width, height, depth) {
  const maxDim = Math.max(width, height, depth);
  const dist = maxDim * 2.2;
  camera.position.set(0, -dist * 0.5, dist * 0.6);
  controls.target.set(0, 0, -depth / 2);
  controls.update();
}

// ---------------------------------------------------------------------------
// Theme sync — re-read CSS tokens and update all scene objects
// ---------------------------------------------------------------------------

export function syncThemeColors() {
  if (!scene) return;
  const tc = getThemeColors();

  scene.background = new THREE.Color(tc.canvasBg);

  // Restyle model (semi-transparent part)
  if (modelGroup) {
    const modelColor = tc.themed ? tc.meshDefault : '#8888cc';
    modelGroup.traverse(child => {
      if (child.isMesh && child.material) {
        child.material.color.set(modelColor);
        if (tc.themed && child.material.emissive) {
          child.material.emissive.set(tc.meshEmissive);
          child.material.emissiveIntensity = tc.meshEmissiveInt * 0.5;
        }
        child.material.needsUpdate = true;
      }
    });
  }

  // Restyle jig mesh
  if (jigMesh) {
    if (jigMesh.material && jigMesh.material.isMeshPhongMaterial) {
      jigMesh.material.emissive.set(tc.themed ? tc.meshEmissive : '#000000');
      jigMesh.material.emissiveIntensity = tc.meshEmissiveInt;
      jigMesh.material.needsUpdate = true;
    }
    jigMesh.traverse(child => {
      if (child.isLineSegments && child.material) {
        child.material.color.set(tc.themed ? tc.meshEdgeColor : '#333333');
        child.material.opacity = tc.themed ? tc.meshEdgeOpacity * 0.3 : 0.15;
        child.material.needsUpdate = true;
      }
    });
  }
}
