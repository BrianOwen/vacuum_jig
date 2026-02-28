// Vacuum Jig Creator — Binary STL export

import * as THREE from 'three';

/**
 * Export a THREE.BufferGeometry as a binary STL file download.
 * @param {THREE.BufferGeometry} geometry
 * @param {string} fileName
 */
export function exportSTL(geometry, fileName) {
  const positions = geometry.attributes.position;
  const index = geometry.index;

  let triCount;
  if (index) {
    triCount = index.count / 3;
  } else {
    triCount = positions.count / 3;
  }

  // Binary STL: 80-byte header + 4-byte tri count + 50 bytes per triangle
  const bufferSize = 80 + 4 + triCount * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // Header (80 bytes) — write a description
  const header = 'Vacuum Jig STL — ShopBot Labs';
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  }

  // Triangle count
  view.setUint32(80, triCount, true);

  let offset = 84;
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    let i0, i1, i2;
    if (index) {
      i0 = index.getX(t * 3);
      i1 = index.getX(t * 3 + 1);
      i2 = index.getX(t * 3 + 2);
    } else {
      i0 = t * 3;
      i1 = t * 3 + 1;
      i2 = t * 3 + 2;
    }

    vA.fromBufferAttribute(positions, i0);
    vB.fromBufferAttribute(positions, i1);
    vC.fromBufferAttribute(positions, i2);

    // Compute face normal
    cb.subVectors(vC, vB);
    ab.subVectors(vA, vB);
    cb.cross(ab).normalize();

    // Normal
    view.setFloat32(offset, cb.x, true); offset += 4;
    view.setFloat32(offset, cb.y, true); offset += 4;
    view.setFloat32(offset, cb.z, true); offset += 4;

    // Vertex A
    view.setFloat32(offset, vA.x, true); offset += 4;
    view.setFloat32(offset, vA.y, true); offset += 4;
    view.setFloat32(offset, vA.z, true); offset += 4;

    // Vertex B
    view.setFloat32(offset, vB.x, true); offset += 4;
    view.setFloat32(offset, vB.y, true); offset += 4;
    view.setFloat32(offset, vB.z, true); offset += 4;

    // Vertex C
    view.setFloat32(offset, vC.x, true); offset += 4;
    view.setFloat32(offset, vC.y, true); offset += 4;
    view.setFloat32(offset, vC.z, true); offset += 4;

    // Attribute byte count
    view.setUint16(offset, 0, true); offset += 2;
  }

  // Trigger download
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
