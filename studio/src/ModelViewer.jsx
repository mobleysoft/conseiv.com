import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export default function ModelViewer({ mesh, wireframe, view, resetKey }) {
  const host = useRef(null), sceneRef = useRef(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = host.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setError('3D viewing needs WebGL 2. You can still generate and export this design.'); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;
    renderer.domElement.setAttribute('aria-label', 'Interactive bracket model. Drag to orbit, pinch or scroll to zoom.');
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.minDistance = 10;
    controls.maxDistance = 2000;
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    scene.add(new THREE.HemisphereLight(0xdbffff, 0x122f30, 2.5));
    for (const [position, color, intensity] of [[[100, -100, 170], 0xcaf8ff, 4], [[-120, 30, 70], 0x21abbf, 3], [[40, 100, 120], 0xffffff, 3]]) {
      const light = new THREE.DirectionalLight(color, intensity);
      light.position.set(...position); scene.add(light);
    }
    const grid = new THREE.GridHelper(500, 50, 0x285458, 0x163033);
    grid.rotation.x = Math.PI / 2;
    grid.material.transparent = true; grid.material.opacity = 0.38;
    scene.add(grid);
    const group = new THREE.Group(); scene.add(group);
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height); camera.aspect = width / height;
      camera.updateProjectionMatrix(); render();
    };
    const observer = new ResizeObserver(resize); observer.observe(element);
    const lost = event => { event.preventDefault(); setError('The graphics context was interrupted. Reload the studio to restore 3D viewing.'); };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    sceneRef.current = { scene, group, camera, controls, grid, render, resize };
    resize();
    return () => {
      observer.disconnect(); controls.dispose();
      scene.traverse(object => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach(m => m.dispose());
        else object.material?.dispose();
      });
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      renderer.dispose(); renderer.domElement.remove(); sceneRef.current = null;
    };
  }, []);
  useEffect(() => {
    const state = sceneRef.current;
    if (!state || !mesh) return;
    for (const child of [...state.group.children]) {
      child.geometry.dispose(); child.material.dispose(); state.group.remove(child);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    geometry.setIndex(mesh.indices); geometry.computeVertexNormals(); geometry.computeBoundingBox();
    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
    const material = new THREE.MeshStandardMaterial({ color: 0x91bdc3, metalness: 0.35, roughness: 0.32, flatShading: true, wireframe });
    state.group.add(new THREE.Mesh(geometry, material));
    if (!wireframe) {
      const edges = new THREE.EdgesGeometry(geometry, 24);
      state.group.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x4f848b, transparent: true, opacity: 0.45 })));
    }
    state.grid.position.z = -center.z - 1;
    const distance = Math.max(size.x, size.y, size.z, 20) * 2.9;
    state.camera.position.set(-distance * 0.58, -distance * 0.72, distance * 0.65);
    if (view === 'flat') state.camera.position.set(0, -distance * 0.32, distance);
    state.controls.target.set(0, 0, 0); state.controls.update(); state.resize(); state.render();
  }, [mesh, wireframe, view, resetKey]);
  return <div className="viewer-host" ref={host}>{error && <div role="alert" className="viewer-error">{error}</div>}</div>;
}
