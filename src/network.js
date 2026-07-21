import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { REGIONS, EDGES } from "./data.js";

// ---- procedural textures (soft radial sprites) so points/glows look round ----
function radialSprite(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)") {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0.0, inner);
  g.addColorStop(0.25, inner);
  g.addColorStop(1.0, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// fresnel rim shell — a glowing edge around each hub that reads as a membrane
function fresnelMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: 3.0 },
      uIntensity: { value: 1.1 },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vView;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uPower; uniform float uIntensity;
      varying vec3 vN; varying vec3 vView;
      void main() {
        float f = pow(1.0 - max(dot(vN, vView), 0.0), uPower);
        gl_FragColor = vec4(uColor * f * uIntensity, f);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

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
    this.clock = 0;
    this._fpsAcc = 0;
    this._fpsN = 0;
    this._adapted = false;
    this._target = new THREE.Vector3(0, 0, 0);
    this._camGoal = null;

    this.glowTex = radialSprite("rgba(255,255,255,0.95)", "rgba(255,255,255,0)");
    this.dotTex = radialSprite("rgba(255,255,255,1)", "rgba(255,255,255,0)");

    this._initRenderer();
    this._initScene();
    this._buildRegions();
    this._buildEdges();
    this._buildNeuronCloud();
    this._initPost();
    this._bindResize();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x05070f, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x05070f, 0.035);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 1.5, 9);

    this.scene.add(new THREE.AmbientLight(0x8199d8, 0.55));
    const key = new THREE.PointLight(0x4fd1ff, 70, 60);
    key.position.set(6, 8, 8);
    this.scene.add(key);
    const rim = new THREE.PointLight(0xb26bff, 55, 60);
    rim.position.set(-8, -4, -6);
    this.scene.add(rim);
    const warm = new THREE.PointLight(0x33e0a0, 30, 50);
    warm.position.set(0, -6, 4);
    this.scene.add(warm);

    this._buildBackdrop();
    this._buildStarfield();
  }

  // inward-facing gradient sphere → soft nebula behind the network
  _buildBackdrop() {
    const geo = new THREE.SphereGeometry(90, 32, 32);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x0a1430) },
        uBottom: { value: new THREE.Color(0x02030a) },
        uGlow: { value: new THREE.Color(0x1b2f6b) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uGlow;
        varying vec3 vPos;
        void main() {
          float h = normalize(vPos).y * 0.5 + 0.5;
          vec3 col = mix(uBottom, uTop, h);
          float r = 1.0 - length(vPos.xy) / 90.0;
          col += uGlow * smoothstep(0.4, 1.0, r) * 0.5;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  _buildStarfield() {
    const layers = [
      { n: 800, size: 0.12, color: 0x9fb8ff, spread: 70 },
      { n: 500, size: 0.22, color: 0x7ee0ff, spread: 60 },
      { n: 300, size: 0.3, color: 0xb26bff, spread: 55 },
    ];
    this.stars = [];
    for (const L of layers) {
      const geo = new THREE.BufferGeometry();
      const arr = new Float32Array(L.n * 3);
      for (let i = 0; i < L.n; i++) {
        arr[i * 3] = (Math.random() - 0.5) * L.spread;
        arr[i * 3 + 1] = (Math.random() - 0.5) * L.spread;
        arr[i * 3 + 2] = (Math.random() - 0.5) * L.spread;
      }
      geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const mat = new THREE.PointsMaterial({
        color: L.color, size: L.size, map: this.dotTex,
        transparent: true, opacity: 0.85, depthWrite: false,
        blending: THREE.AdditiveBlending, sizeAttenuation: true,
      });
      const pts = new THREE.Points(geo, mat);
      this.scene.add(pts);
      this.stars.push(pts);
    }
  }

  _buildRegions() {
    const geo = new THREE.SphereGeometry(0.34, 48, 48);
    for (const r of REGIONS) {
      const color = new THREE.Color(r.color);
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.35,
        roughness: 0.3,
        metalness: 0.3,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.fromArray(r.pos);
      mesh.userData.region = r;

      // fresnel membrane rim
      const rim = new THREE.Mesh(new THREE.SphereGeometry(0.4, 48, 48), fresnelMaterial(color));
      mesh.add(rim);
      mesh.userData.rim = rim;

      // soft outer halo (still a mesh, kept for compatibility with update())
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 24, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      mesh.add(halo);
      mesh.userData.halo = halo;

      // billboard glow sprite → bloom-friendly volumetric shine
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color, transparent: true, opacity: 0.28,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.scale.setScalar(1.3);
      mesh.add(glow);
      mesh.userData.glow = glow;

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
      const ca = new THREE.Color(this.regionMeshes.get(a).userData.region.color);
      const cb = new THREE.Color(this.regionMeshes.get(b).userData.region.color);
      const geo = new THREE.BufferGeometry().setFromPoints([pa.clone(), pb.clone()]);
      geo.setAttribute("color", new THREE.Float32BufferAttribute([ca.r, ca.g, ca.b, cb.r, cb.g, cb.b], 3));
      const mat = new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.userData.edge = [a, b];
      this.scene.add(line);
      this.edgeLines.push(line);
    }
  }

  _buildNeuronCloud() {
    const geo = new THREE.BufferGeometry();
    const n = 2000;
    const arr = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = REGIONS[Math.floor(Math.random() * REGIONS.length)];
      // gaussian-ish clustering around hubs for a denser core
      const spread = 0.5 + Math.random() * 1.3;
      arr[i * 3] = r.pos[0] + (Math.random() - 0.5) * spread * 2;
      arr[i * 3 + 1] = r.pos[1] + (Math.random() - 0.5) * spread * 2;
      arr[i * 3 + 2] = r.pos[2] + (Math.random() - 0.5) * spread * 2;
      const c = new THREE.Color(r.color).lerp(new THREE.Color(0xffffff), Math.random() * 0.35);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.06, map: this.dotTex, vertexColors: true,
      transparent: true, opacity: 0.7, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.neuronCloud = new THREE.Points(geo, mat);
    this.scene.add(this.neuronCloud);
  }

  _initPost() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.45, // strength
      0.5, // radius
      0.4 // threshold
    );
    this.composer.addPass(this.bloom);
    // bloom is a blur, so render it at half resolution to save fillrate
    this.composer.setPixelRatio(0.5);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  _bindResize() {
    window.addEventListener("resize", () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.composer.setSize(w, h);
      this.bloom.setSize(w, h);
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
        const region = REGIONS.find((r) => r.id === fromId);
        const color = new THREE.Color(region ? region.color : 0xffffff);
        const dot = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.glowTex, color, transparent: true, opacity: 0.95,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        dot.scale.setScalar(0.55);
        this.scene.add(dot);
        this.pulses.push({ dot, from: this.regionMeshes.get(start).position, to: this.regionMeshes.get(end).position, t: 0 });
      }
    }
  }

  update(dt) {
    this.clock += dt;
    // one-shot adaptive quality: if the first ~2s average below 30fps, drop the
    // (expensive) bloom pass so weak GPUs stay smooth.
    if (!this._adapted && dt > 0) {
      this._fpsAcc += 1 / dt;
      this._fpsN++;
      if (this._fpsN >= 90) {
        if (this._fpsAcc / this._fpsN < 30) this.bloom.enabled = false;
        this._adapted = true;
      }
    }
    // region node pulsing from activity
    for (const [id, mesh] of this.regionMeshes) {
      const a = (this.activity.get(id) || 0) * this.gain;
      const breathe = 1 + 0.03 * Math.sin(this.clock * 2 + mesh.position.x);
      const s = (1 + a * 0.6) * breathe;
      mesh.scale.setScalar(s);
      mesh.material.emissiveIntensity = 0.3 + a * 1.0;
      mesh.userData.halo.material.opacity = 0.05 + a * 0.16;
      mesh.userData.halo.scale.setScalar(1 + a * 0.6);
      mesh.userData.rim.material.uniforms.uIntensity.value = 0.7 + a * 1.2;
      mesh.userData.glow.material.opacity = 0.18 + a * 0.3;
      mesh.userData.glow.scale.setScalar(1.2 + a * 0.9);
    }

    // edges brighten with the mean activity of their endpoints
    for (const line of this.edgeLines) {
      const [a, b] = line.userData.edge;
      const act = ((this.activity.get(a) || 0) + (this.activity.get(b) || 0)) * 0.5 * this.gain;
      line.material.opacity = 0.22 + Math.min(0.65, act * 0.7);
    }

    // travel pulses
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += dt * 1.4 * this.flySpeed;
      if (p.t >= 1) {
        this.scene.remove(p.dot);
        p.dot.material.dispose();
        this.pulses.splice(i, 1);
        continue;
      }
      p.dot.position.lerpVectors(p.from, p.to, p.t);
      p.dot.material.opacity = 0.95 * (1 - Math.abs(p.t - 0.5) * 1.4);
    }

    // slow drift for depth
    this.neuronCloud.rotation.y += dt * 0.02;
    if (this.stars) {
      this.stars[0].rotation.y += dt * 0.005;
      this.stars[2].rotation.y -= dt * 0.008;
    }

    // camera fly-to
    if (this._camGoal) {
      this.camera.position.lerp(this._camGoal, Math.min(1, dt * 2.0 * this.flySpeed));
      if (this.camera.position.distanceTo(this._camGoal) < 0.05) this._camGoal = null;
    }
    this.camera.lookAt(this._target);

    this.composer.render();
  }

  raycastRegion(nx, ny) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hits = ray.intersectObjects([...this.regionMeshes.values()], false);
    return hits.length ? hits[0].object.userData.region : null;
  }
}
