// 3D Carver — STL and STEP File Loader
// Adapted from slicer_app with orientation support

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

let occtInstance = null;
const MM_TO_INCH = 1 / 25.4;

/**
 * Load a 3D model file (STL or STEP).
 * @param {File} file
 * @returns {Promise<{ group: THREE.Group, bounds: Object, wasMetric: boolean }>}
 */
export async function loadFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'stl') {
    return loadSTL(file);
  } else if (ext === 'step' || ext === 'stp') {
    return loadSTEP(file);
  } else {
    throw new Error(`Unsupported file type: .${ext}`);
  }
}

async function loadSTL(file) {
  const buffer = await file.arrayBuffer();
  const loader = new STLLoader();
  const geometry = loader.parse(buffer);

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const maxDim = Math.max(
    box.max.x - box.min.x,
    box.max.y - box.min.y,
    box.max.z - box.min.z
  );

  // Heuristic: if max dimension > 100, assume mm and convert to inches
  const isMetric = maxDim > 100;
  if (isMetric) {
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      positions.setX(i, positions.getX(i) * MM_TO_INCH);
      positions.setY(i, positions.getY(i) * MM_TO_INCH);
      positions.setZ(i, positions.getZ(i) * MM_TO_INCH);
    }
    positions.needsUpdate = true;
    geometry.computeBoundingBox();
  }

  geometry.computeVertexNormals();

  const material = new THREE.MeshPhongMaterial({
    color: 0xcccccc,
    side: THREE.DoubleSide,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geometry, material);

  const edges = new THREE.EdgesGeometry(geometry, 30);
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.3 });
  mesh.add(new THREE.LineSegments(edges, edgeMaterial));

  const group = new THREE.Group();
  group.add(mesh);

  const bounds = calculateBoundingBox(group);
  return { group, bounds, wasMetric: isMetric };
}

async function initOCCT() {
  if (occtInstance) return occtInstance;

  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.js';

  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });

  occtInstance = await window.occtimportjs();
  return occtInstance;
}

async function loadSTEP(file) {
  const occt = await initOCCT();

  const buffer = await file.arrayBuffer();
  const result = occt.ReadStepFile(new Uint8Array(buffer));

  if (!result.success) {
    throw new Error('Failed to parse STEP file');
  }

  const group = convertToThreeMesh(result);
  const bounds = calculateBoundingBox(group);

  return { group, bounds, wasMetric: true };
}

function convertToThreeMesh(result) {
  const group = new THREE.Group();
  const scale = MM_TO_INCH; // STEP files are always in mm

  const material = new THREE.MeshPhongMaterial({
    color: 0xcccccc,
    side: THREE.DoubleSide,
    flatShading: false,
  });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.3 });

  for (const meshData of result.meshes) {
    const geometry = new THREE.BufferGeometry();

    let positions, normals, indices;
    if (meshData.attributes) {
      positions = meshData.attributes.position?.array || meshData.attributes.position;
      normals = meshData.attributes.normal?.array || meshData.attributes.normal;
      indices = meshData.index?.array || meshData.index;
    } else {
      positions = meshData.vertices || meshData.position;
      normals = meshData.normals || meshData.normal;
      indices = meshData.indices || meshData.index;
    }

    if (!positions) continue;

    let posArray = positions instanceof Float32Array ? positions : new Float32Array(positions);
    const scaled = new Float32Array(posArray.length);
    for (let i = 0; i < posArray.length; i++) {
      scaled[i] = posArray[i] * scale;
    }
    posArray = scaled;

    geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

    if (normals) {
      const normArray = normals instanceof Float32Array ? normals : new Float32Array(normals);
      geometry.setAttribute('normal', new THREE.BufferAttribute(normArray, 3));
    } else {
      geometry.computeVertexNormals();
    }

    if (indices) {
      const idxArray = indices instanceof Uint32Array ? indices :
                       indices instanceof Uint16Array ? indices :
                       new Uint32Array(indices);
      geometry.setIndex(new THREE.BufferAttribute(idxArray, 1));
    }

    const mesh = new THREE.Mesh(geometry, material.clone());

    const edges = new THREE.EdgesGeometry(geometry, 30);
    mesh.add(new THREE.LineSegments(edges, edgeMaterial));

    if (meshData.color && Array.isArray(meshData.color)) {
      mesh.material.color.setRGB(meshData.color[0], meshData.color[1], meshData.color[2]);
    }

    group.add(mesh);
  }

  return group;
}

/**
 * Apply orientation rotation to a model group.
 * Returns a new group with the oriented model, bottom at Z=0, centered on XY.
 * Orientations describe which face of the model points UP (toward the cutter).
 */
export function orientModel(sourceGroup, orientation) {
  // Build orientation matrix
  const rotGroup = new THREE.Group();
  switch (orientation) {
    case 'top':    break;
    case 'bottom': rotGroup.rotation.x = Math.PI; break;
    case 'front':  rotGroup.rotation.x = -Math.PI / 2; break;
    case 'back':   rotGroup.rotation.x = Math.PI / 2; break;
    case 'right':  rotGroup.rotation.y = Math.PI / 2; break;
    case 'left':   rotGroup.rotation.y = -Math.PI / 2; break;
  }
  rotGroup.updateMatrix();

  // Clone source and bake orientation + recentering into each mesh geometry
  // so the resulting group has identity transforms — no ambiguity for raycasting
  const oriented = new THREE.Group();

  sourceGroup.traverse(child => {
    if (!child.isMesh) return;

    const geom = child.geometry.clone();

    // Bake the child's own world matrix (from the source group hierarchy)
    child.updateWorldMatrix(true, false);
    geom.applyMatrix4(child.matrixWorld);

    // Apply orientation rotation
    geom.applyMatrix4(rotGroup.matrix);

    const mesh = new THREE.Mesh(geom, child.material.clone());

    // Re-add edge wireframe if the original had one
    child.children.forEach(sub => {
      if (sub.isLineSegments) {
        const edges = new THREE.EdgesGeometry(geom, 30);
        mesh.add(new THREE.LineSegments(edges, sub.material.clone()));
      }
    });

    oriented.add(mesh);
  });

  // Recenter: centered on all axes (XY and Z)
  const bbox = new THREE.Box3().setFromObject(oriented, true);
  const center = bbox.getCenter(new THREE.Vector3());

  oriented.traverse(child => {
    if (child.geometry) {
      child.geometry.translate(-center.x, -center.y, -center.z);
    }
  });

  oriented.updateMatrixWorld(true);
  return oriented;
}

/**
 * Calculate bounding box of a Three.js object.
 */
export function calculateBoundingBox(object) {
  const box = new THREE.Box3().setFromObject(object, true);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
    size: { x: size.x, y: size.y, z: size.z },
    center: { x: center.x, y: center.y, z: center.z },
  };
}
