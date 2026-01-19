import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/meshopt_decoder.module.js';
import { SimplexNoise } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/math/SimplexNoise.js';
import { VRButton } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/webxr/VRButton.js';
import Stats from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/stats.module.js';

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

// Scene + Camera
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);

// camera rig so XR head tracking offsets from this base transform
const cameraRig = new THREE.Group();
cameraRig.position.set(0, 0, 3);
cameraRig.add(camera);
scene.add(cameraRig);

const target = new THREE.Vector3(0, -0.125, 0);
const orbitRadius = cameraRig.position.length(); // lock radius once

// VR button (only if supported)
const vrButton = VRButton.createButton(renderer);
vrButton.id = 'vr-button';
vrButton.style.display = 'none';

if ('xr' in navigator) {
  navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    if (supported) {
      vrButton.style.display = '';
      vrButton.textContent = 'ENTER VR';
      document.body.appendChild(vrButton);
    }
  });
}

// Light
scene.add(new THREE.AmbientLight(0x404040, 20));

// Background wavy wall
const bgW = 130;
const bgH = 130;
const bgSeg = 500;
const bgGeometry = new THREE.PlaneGeometry(bgW, bgH, bgSeg, bgSeg);

const bgTexture = new THREE.TextureLoader().load('background2.jpg', (tex) => {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(23, 35);
});

const bgMaterial = new THREE.MeshBasicMaterial({ map: bgTexture, side: THREE.DoubleSide });
const bgPlane = new THREE.Mesh(bgGeometry, bgMaterial);
bgPlane.position.set(0, 0, -7.77);
scene.add(bgPlane);

const simplex = new SimplexNoise();

// Placeholder
const placeholderTexture = new THREE.TextureLoader().load('./img/theguy2.png');
placeholderTexture.colorSpace = THREE.SRGBColorSpace;

const placeholderMaterial = new THREE.MeshBasicMaterial({
  map: placeholderTexture,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});

const placeholderPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), placeholderMaterial);
placeholderPlane.position.set(0.07, 0.1, -3.75);
camera.add(placeholderPlane);

// Star FX (billboarded instanced GLB)

const starFXGroup = new THREE.Group();
scene.add(starFXGroup);
const STAR_SPAWN_NODE_NAME = 'fingertip';
const STAR_RATE = 30;          // per second
const STAR_LIFE = 1.2;         // seconds (0.1 in + 1.0 out)
const STAR_IN = 0.2;           // seconds to scale up
const STAR_MAX = 420;           // max alive at once
const STAR_MAX_SCALE = 0.033342069;   // <-- tweak this (world units-ish multiplier)

let starSpawnNode = null;

let starReady = false;
let starInstancedMeshes = []; // one InstancedMesh per mesh in star.glb
let starFree = [];            // available indices
let starAge = new Float32Array(STAR_MAX);
let starSeed = new Float32Array(STAR_MAX);
let starDir = Array.from({ length: STAR_MAX }, () => new THREE.Vector3());
let starStart = Array.from({ length: STAR_MAX }, () => new THREE.Vector3());
let starSpeed = new Float32Array(STAR_MAX);

let starSpawnAcc = 0;

const _spawnWorld = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _mat = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _white = new THREE.Color(1, 1, 1);

function initStarPools() {
  starFree.length = 0;
  for (let i = STAR_MAX - 1; i >= 0; i--) {
    starFree.push(i);
    starAge[i] = -1;
  }
}

function forceMaterialWhite(m) {
  // Convert anything into a predictable unlit white material
  // (keeps transparency if present)
  const base = {
    color: _white,
    transparent: !!m.transparent,
    opacity: m.opacity ?? 1,
    depthWrite: false, // helps avoid popping when many overlap
  };
  return new THREE.MeshBasicMaterial(base);
}

function loadStarOnce() {
  if (starReady) return;
  initStarPools();

  const starLoader = new GLTFLoader();
  starLoader.setMeshoptDecoder(MeshoptDecoder);

  starLoader.load(
    './star-optimized.glb',
    (gltf) => {
      const root = gltf.scene;

      const meshes = [];
      root.traverse((o) => {
        if (o.isMesh && o.geometry && o.material) meshes.push(o);
      });

      if (!meshes.length) {
        console.warn('[StarFX] star.glb loaded but contained no meshes.');
        return;
      }

      starInstancedMeshes = meshes.map((src) => {
        const geom = src.geometry;
        const matSrc = src.material;

        // Force white unlit material(s)
        const mat = Array.isArray(matSrc)
          ? matSrc.map(forceMaterialWhite)
          : forceMaterialWhite(matSrc);

        const im = new THREE.InstancedMesh(geom, mat, STAR_MAX);
        im.frustumCulled = false;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        // Start with all instances scaled to 0
        for (let i = 0; i < STAR_MAX; i++) {
          _mat.identity().scale(new THREE.Vector3(0, 0, 0));
          im.setMatrixAt(i, _mat);
        }
        im.instanceMatrix.needsUpdate = true;

        starFXGroup.add(im);
        return im;
      });

      starReady = true;
      console.log(`[StarFX] Ready. Mesh parts: ${starInstancedMeshes.length}, instances: ${STAR_MAX}`);
    },
    undefined,
    (err) => console.error('[StarFX] load error:', err)
  );
}

function pickSpawnNode(modelRoot) {
  const n = modelRoot.getObjectByName(STAR_SPAWN_NODE_NAME);
  if (!n) console.warn(`[StarFX] Spawn node "${STAR_SPAWN_NODE_NAME}" not found. Falling back to model root.`);
  return n || modelRoot;
}

function spawnStar(worldPos) {
  if (!starReady || starFree.length === 0) return;

  const id = starFree.pop();

  starAge[id] = 0;
  starSeed[id] = Math.random() * 1000.0;

  starStart[id].copy(worldPos);

  // Direction: roughly away from camera, with slight random spread
  _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize(); // camera forward (world)
  starDir[id].copy(_fwd).multiplyScalar(-1); // away from camera
  starDir[id]
    .add(new THREE.Vector3((Math.random() - 0.5) * 0.35, (Math.random() - 0.2) * 0.35, (Math.random() - 0.5) * 0.35))
    .normalize();

  // Speed in world units/sec
  starSpeed[id] = 0.8 + Math.random() * 0.1;
}

function killStar(id) {
  starAge[id] = -1;
  starFree.push(id);

  _mat.identity().scale(new THREE.Vector3(0, 0, 0));
  for (const im of starInstancedMeshes) im.setMatrixAt(id, _mat);
}

function updateStarFX(dt) {
  if (!starReady || !starSpawnNode) return;

  // Emit at fixed rate
  starSpawnAcc += dt * STAR_RATE;

  // World position of spawn attachment
  starSpawnNode.getWorldPosition(_spawnWorld);

  while (starSpawnAcc >= 1.0) {
    starSpawnAcc -= 1.0;
    spawnStar(_spawnWorld);
  }

  // Billboard rotation
  _quat.copy(camera.quaternion);

  // Camera basis for wobble
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  _up.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();

  let anyDirty = false;

  for (let i = 0; i < STAR_MAX; i++) {
    const age = starAge[i];
    if (age < 0) continue;

    const t = age + dt;
    starAge[i] = t;

    // Scale envelope: 0 -> 1 over 0.1s, then 1 -> 0 over 1.0s
    let s = 0;
    if (t < STAR_IN) s = t / STAR_IN;
    else s = 1.0 - (t - STAR_IN) / (STAR_LIFE - STAR_IN);

    if (s <= 0 || t >= STAR_LIFE) {
      killStar(i);
      anyDirty = true;
      continue;
    }

    // Motion: drift away + gentle wiggle
    const travel = t * starSpeed[i];
    const seed = starSeed[i];

    const wob1 = Math.sin((t * 3.0) + seed) * 0.06;
    const wob2 = Math.sin((t * 4.5) + seed * 1.7) * 0.04;
    const wobN = simplex.noise3d(seed * 0.01, t * 0.6, 0) * 0.05;

    _pos.copy(starStart[i]);
    _pos.addScaledVector(starDir[i], travel);
    _pos.addScaledVector(_right, wob1 + wobN);
    _pos.addScaledVector(_up, wob2);

    // Ease scale and apply global max factor
    const eased = s * s * (3 - 2 * s);
    _scale.setScalar(eased * STAR_MAX_SCALE);

    _mat.compose(_pos, _quat, _scale);
    for (const im of starInstancedMeshes) im.setMatrixAt(i, _mat);
    anyDirty = true;
  }

  if (anyDirty) {
    for (const im of starInstancedMeshes) im.instanceMatrix.needsUpdate = true;
  }
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

let model = null;
let mixer;
const clock = new THREE.Clock();

loader.load(
  './scene16-opt.glb',
  (gltf) => {
    model = gltf.scene;

    // scale to 2.5 u
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    model.scale.setScalar(2.5 / size);

    // adjust materials metalness
    model.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if ('metalness' in m) m.metalness = 0.5;
      }
    });

    // scale light intensities
    model.traverse((child) => {
      if (!child.isLight) return;
      child.intensity *= 0.25;
    });

    scene.add(model);

    const names = [];
model.traverse(o => {
  if (o.name) names.push(o.name);
});
console.log(names.sort());

    // animate
    if (gltf.animations && gltf.animations.length) {
      mixer = new THREE.AnimationMixer(model);
      const clip = gltf.animations[0];
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
    }

    // Star FX hookup
    starSpawnNode = pickSpawnNode(model);
    loadStarOnce();

    // fade out placeholder
    let o = 1;
    (function fade() {
      if ((o -= 0.04) <= 0) {
        camera.remove(placeholderPlane);
        return;
      }
      placeholderPlane.material.opacity = o;
      requestAnimationFrame(fade);
    })();
  },
  undefined,
  (err) => console.error('[GLB] load error:', err)
);

// ------------------------------------------------------------
// Input (mouse + touch)
// ------------------------------------------------------------
let inputX = 0;
let inputY = 0;
const parallaxIntensity = 5;

function setInputFromClientXY(clientX, clientY) {
  inputX = (clientX / window.innerWidth - 0.5) * 2;
  inputY = (clientY / window.innerHeight - 0.5) * 2;
}

addEventListener('mousemove', (e) => setInputFromClientXY(e.clientX, e.clientY), { passive: true });

addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length === 1) setInputFromClientXY(e.touches[0].clientX, e.touches[0].clientY);
  },
  { passive: true }
);

addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length === 1) setInputFromClientXY(e.touches[0].clientX, e.touches[0].clientY);
  },
  { passive: true }
);

// ------------------------------------------------------------
// Resize
// ------------------------------------------------------------
addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
});

// ------------------------------------------------------------
// Camera parallax orbit (desktop/touch when not in XR)
// ------------------------------------------------------------
function updateCameraParallax() {
  if (!model) return;

  const angleY = -inputX * parallaxIntensity * 0.1;
  const angleX = inputY * parallaxIntensity * 0.1;

  const phi = Math.PI / 2 - angleX;
  const theta = angleY;

  cameraRig.position.x = orbitRadius * Math.sin(phi) * Math.sin(theta);
  cameraRig.position.y = orbitRadius * Math.cos(phi);
  cameraRig.position.z = orbitRadius * Math.sin(phi) * Math.cos(theta);

  camera.lookAt(target);
}

// ------------------------------------------------------------
// Animate
// ------------------------------------------------------------
function animate() {
  const dt = clock.getDelta();
  if (mixer) mixer.update(dt);

  updateStarFX(dt);

  // scroll texture diagonally
  bgTexture.offset.x += -0.001;
  bgTexture.offset.y += -0.001;

  // displace wall via simplex noise
  const positions = bgGeometry.attributes.position;
  const t = performance.now() * 0.001;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    positions.setZ(i, simplex.noise3d(x * 0.18, y * 0.18, t * 0.3) * 1.4);
  }
  positions.needsUpdate = true;

  // only apply parallax when not in XR
  if (!renderer.xr.isPresenting) updateCameraParallax();

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
