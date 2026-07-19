import * as THREE from "three";
import { REGIONS, EDGES } from "./data.js";

// Builds and manages the 3D neural-network scene: region hub nodes, connectome
// edges, a diffuse "neuron cloud", and animated signal-propagation pulses.
export class NeuralNetwork {
  constructor(canvas) {
    this.canvas = canvas;
    this.regionMeshes = new Map();
    this.activity = new Map();
    this.pulses = [];
    this.pulsesEnabled = true;
    this.gain = 1;
    this.flySpeed = 1;
    this._target = new THREE.Vector3(0, 0, 0);
    this._camGoal = null;

    this._initRenderer();
    this._initScene();
    this._buildRegions();
    this._buildEdges();
    this._buildNeuronCloud();
    this._bindResize();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x05070f, 0.045);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 1.5, 9);

    this.scene.add(new THREE.AmbientLight(0x88aaff, 0.6));
    const key = new THREE.PointLight(0x4fd1ff, 60, 40);
    key.position.set(6, 8, 8);
    this.scene.add(key);
    const rim = new THREE.PointLight(0xb26bff, 40, 40);
    rim.position.set(-8, -4, -6);
    this.scene.add(rim);

    // starfield-ish backdrop of distant micro-neurons
    const bgGeo = new THREE.BufferGeometry();
    const n = 1200;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 40;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 40;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    bgGeo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const bg = new THREE.Points(bgGeo, new THREE.PointsMaterial({ color: 0x22345f, size: 0.05 }));
    this.scene.add(bg);
  }

  _buildRegions() {
    const geo = new THREE.SphereGeometry(0.34, 32, 32);
    for (const r of REGIONS) {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(r.color),
        emissive: new THREE.Color(r.color),
        emissiveIntensity: 0.4,
        roughness: 0.35,
        metalness: 0.1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.fromArray(r.pos);
      mesh.userData.region = r;

      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 24, 24),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(r.color), transparent: true, opacity: 0.12 })
      );
      mesh.add(halo);
      mesh.userData.halo = halo;

      this.scene.add(mesh);
      this.regionMeshes.set(r.id, mesh);
      this.activity.set(r.id, 0.3);
    }
  }

  _buildEdges() {
    this.edgeLines = [];
    for (const [a, b] of EDGES) {
      const pa = this.regionMeshes.get(a).position;
      const pb = this.regionMeshes.get(b).position;
      const geo = new THREE.BufferGeometry().setFromPoints([pa.clone(), pb.clone()]);
      const mat = new THREE.LineBasicMaterial({ color: 0x3a5fa0, transparent: true, opacity: 0.35 });
      const line = new THREE.Line(geo, mat);
      line.userData.edge = [a, b];
      this.scene.add(line);
      this.edgeLines.push(line);
    }
  }

  _buildNeuronCloud() {
    const geo = new THREE.BufferGeometry();
    const n = 2600;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // sample points loosely around the region hubs to suggest dense neurons
      const r = REGIONS[Math.floor(Math.random() * REGIONS.length)];
      arr[i * 3] = r.pos[0] + (Math.random() - 0.5) * 1.6;
      arr[i * 3 + 1] = r.pos[1] + (Math.random() - 0.5) * 1.6;
      arr[i * 3 + 2] = r.pos[2] + (Math.random() - 0.5) * 1.6;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({ color: 0x6fd0ff, size: 0.035, transparent: true, opacity: 0.5 });
    this.neuronCloud = new THREE.Points(geo, mat);
    this.scene.add(this.neuronCloud);
  }

  _bindResize() {
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  setActivity(id, value) {
    this.activity.set(id, value);
  }

  // Fly the camera toward a region and look at it.
  focusRegion(id) {
    const mesh = this.regionMeshes.get(id);
    if (!mesh) return;
    const p = mesh.position;
    const dir = p.clone().normalize();
    this._camGoal = p.clone().add(dir.multiplyScalar(2.6)).add(new THREE.Vector3(0, 0.6, 0));
    this._target.copy(p);
    this.emitPulse(id);
  }

  // Spawn a traveling pulse from a region along its edges.
  emitPulse(fromId) {
    if (!this.pulsesEnabled) return;
    for (const line of this.edgeLines) {
      const [a, b] = line.userData.edge;
      if (a === fromId || b === fromId) {
        const start = a === fromId ? a : b;
        const end = a === fromId ? b : a;
        const geo = new THREE.SphereGeometry(0.08, 12, 12);
        const region = REGIONS.find((r) => r.id === fromId);
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(region ? region.color : 0xffffff) });
        const dot = new THREE.Mesh(geo, mat);
        this.scene.add(dot);
        this.pulses.push({ dot, from: this.regionMeshes.get(start).position, to: this.regionMeshes.get(end).position, t: 0 });
      }
    }
  }

  update(dt) {
    // region node pulsing from activity
    for (const [id, mesh] of this.regionMeshes) {
      const a = (this.activity.get(id) || 0) * this.gain;
      const s = 1 + a * 0.6;
      mesh.scale.setScalar(s);
      mesh.material.emissiveIntensity = 0.3 + a * 1.4;
      mesh.userData.halo.material.opacity = 0.08 + a * 0.25;
      mesh.userData.halo.scale.setScalar(1 + a * 0.8);
    }

    // travel pulses
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += dt * 1.4 * this.flySpeed;
      if (p.t >= 1) {
        this.scene.remove(p.dot);
        this.pulses.splice(i, 1);
        continue;
      }
      p.dot.position.lerpVectors(p.from, p.to, p.t);
    }

    // slowly rotate neuron cloud for depth
    this.neuronCloud.rotation.y += dt * 0.02;

    // camera fly-to
    if (this._camGoal) {
      this.camera.position.lerp(this._camGoal, Math.min(1, dt * 2.0 * this.flySpeed));
      if (this.camera.position.distanceTo(this._camGoal) < 0.05) this._camGoal = null;
    }
    this.camera.lookAt(this._target);

    this.renderer.render(this.scene, this.camera);
  }

  raycastRegion(nx, ny) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hits = ray.intersectObjects([...this.regionMeshes.values()], false);
    return hits.length ? hits[0].object.userData.region : null;
  }
}
