// Vacuum Jig Creator — Three.js preview
// Model display (semi-transparent) + jig mesh visualization

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let renderer, scene, camera, controls;
let modelGroup, jigMesh;
let isDarkMode = false;

export function initThreeScene() {
  const canvas = document.getElementById('threeCanvas');
  const container = document.getElementById('canvasContainer');

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f0f0);

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

  // Make semi-transparent
  modelGroup.traverse(child => {
    if (child.isMesh) {
      child.material = child.material.clone();
      child.material.transparent = true;
      child.material.opacity = 0.35;
      child.material.depthWrite = false;
      child.material.color.set(0x8888cc);
    }
    // Hide edge wireframes on the transparent model
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

  const material = new THREE.MeshPhongMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    shininess: 30,
  });

  jigMesh = new THREE.Mesh(geometry, material);

  // Add edge wireframe
  const edges = new THREE.EdgesGeometry(geometry, 20);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.15 });
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
// Theme
// ---------------------------------------------------------------------------

export function setTheme(isDark) {
  isDarkMode = isDark;
  if (scene) {
    scene.background = new THREE.Color(isDark ? 0x1d1d1f : 0xf0f0f0);
  }
}
