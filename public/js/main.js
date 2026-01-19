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

const bgW = 100;
const bgH = 100;
const bgSeg = 500;
const bgGeometry = new THREE.PlaneGeometry(bgW, bgH, bgSeg, bgSeg);

const bgTexture = new THREE.TextureLoader().load('background2.jpg', (tex) => {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(19, 30);
});

const bgMaterial = new THREE.MeshBasicMaterial({ map: bgTexture, side: THREE.DoubleSide });
const bgPlane = new THREE.Mesh(bgGeometry, bgMaterial);
bgPlane.position.set(0, 0, -7.77); // behind model
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

// Model loading

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

let model = null;
let mixer;
const clock = new THREE.Clock();

loader.load(
  './scene-optimized12.glb',
  (gltf) => {
    model = gltf.scene;

    // scale to ~2.5 "units"
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
    let glbLights = 0;
    model.traverse((child) => {if (!child.isLight) return; child.intensity *= 0.25; glbLights++;});

    scene.add(model);

    // animate
    if (gltf.animations && gltf.animations.length) {
      mixer = new THREE.AnimationMixer(model);
      const clip = gltf.animations[0];
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
    }

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
    //stats.begin();

  // play gltf animation
  const dt = clock.getDelta();
  if (mixer) mixer.update(dt);
  
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
  //stats.end();
}

/*
const stats = new Stats();
stats.dom.style.position = 'fixed';
stats.dom.style.left = '10px';
stats.dom.style.top = '10px';
stats.dom.style.zIndex = '9999';
document.body.appendChild(stats.dom);
*/

renderer.setAnimationLoop(animate);
