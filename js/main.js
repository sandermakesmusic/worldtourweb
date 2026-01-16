import * as THREE from '../three/build/three.module.js';
import { GLTFLoader } from '../three/examples/jsm/loaders/GLTFLoader.js';
import { SimplexNoise } from '../three/examples/jsm/math/SimplexNoise.js';

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000);
document.body.appendChild(renderer.domElement);

// ---------- Scene & Camera ----------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 1000);
camera.position.set(0,0,3);
const target = new THREE.Vector3(0,-0.125,0);

// ---------- Ambient light ----------
const ambient = new THREE.AmbientLight(0x404040,20);
scene.add(ambient);

// ---------- Background wavy wall ----------
const width=100, height=100, segments=600;
const bgGeometry = new THREE.PlaneGeometry(width,height,segments,segments);
const bgTexture = new THREE.TextureLoader().load('background2.jpg', (tex)=>{
    tex.wrapS=THREE.RepeatWrapping;
    tex.wrapT=THREE.RepeatWrapping;
    tex.repeat.set(19,30);
});
const bgMaterial = new THREE.MeshBasicMaterial({map:bgTexture, side:THREE.DoubleSide});
const bgPlane = new THREE.Mesh(bgGeometry,bgMaterial);
//bgPlane.rotation.x = Math.PI/2; // vertical wall
bgPlane.position.set(0,0,-7.77);
scene.add(bgPlane);

const simplex = new SimplexNoise();

// ---------- Placeholder PNG ----------
const placeholderTexture = new THREE.TextureLoader().load('../img/theguy2.png');
placeholderTexture.colorSpace = THREE.SRGBColorSpace;
const placeholderMaterial = new THREE.MeshBasicMaterial({map:placeholderTexture, transparent:true});
const placeholderPlane = new THREE.Mesh(new THREE.PlaneGeometry(2,2), placeholderMaterial);
camera.add(placeholderPlane);
placeholderPlane.position.set(.07,.1,-3.75);
placeholderPlane.material.depthTest = false;
scene.add(camera);

let earthPlane = null;

// ---------- GLB Loader ----------
const loader = new GLTFLoader();
let model = null;
loader.load('../scene.glb', (gltf)=>{
    model = gltf.scene;

    // Scale
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3()).length();
    const scale = 2.5/size;
    model.scale.setScalar(scale);

    const rotator = model.getObjectByName('rotator');
    if (!rotator) console.warn('rotator group not found!');

    earthPlane = rotator.getObjectByName('earth_planegltf'); 
    if (!earthPlane) console.warn('earth_planegltf not found!');

    // Metalness
    model.traverse(obj=>{
        if(obj.isMesh && obj.material){
            const mats = Array.isArray(obj.material)?obj.material:[obj.material];
            mats.forEach(m=>{if('metalness' in m)m.metalness=0.5;});
            //mats.forEach(m=>{if('roughness' in m)m.roughness=0.5;});
        }
    });
    
    scene.add(model);

    // fade + remove
let o = 1;
(function fade() {
  if ((o -= 0.04) <= 0) return camera.remove(placeholderPlane);
  placeholderPlane.material.opacity = o;
  requestAnimationFrame(fade);
})();

    // GLB lights
    let glbLights=0;
    model.traverse(child=>{
        if(child.isLight){
            child.intensity*=0.25;
            console.log('GLB light:',child.type,'Intensity:',child.intensity);
            glbLights++;
        }
    });
    if(glbLights===0) console.warn('No lights in GLB!');

});

// ---------- Input ----------
let inputX=0, inputY=0;
const parallaxIntensity=5;
document.addEventListener('mousemove', e=>{
    inputX = (e.clientX/window.innerWidth-0.5)*2;
    inputY = (e.clientY/window.innerHeight-0.5)*2;
});
document.addEventListener('touchstart', e=>{
    if(e.touches.length===1){
        inputX=(e.touches[0].clientX/window.innerWidth-0.5)*2;
        inputY=(e.touches[0].clientY/window.innerHeight-0.5)*2;
    }
});
document.addEventListener('touchmove', e=>{
    if(e.touches.length===1){
        inputX=(e.touches[0].clientX/window.innerWidth-0.5)*2;
        inputY=(e.touches[0].clientY/window.innerHeight-0.5)*2;
    }
});

// ---------- Resize ----------
window.addEventListener('resize',()=>{
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Camera orbit ----------
function updateCameraParallax(){
    if(!model) return;
    const radius = camera.position.length();
    const angleY = -inputX * parallaxIntensity * 0.1;
    const angleX = inputY * parallaxIntensity * 0.1;
    const phi = Math.PI/2 - angleX;
    const theta = angleY;
    camera.position.x = radius*Math.sin(phi)*Math.sin(theta);
    camera.position.y = radius*Math.cos(phi);
    camera.position.z = radius*Math.sin(phi)*Math.cos(theta);
    camera.lookAt(target);
}

// ---------- Animate ----------
function animate(){
    requestAnimationFrame(animate);
    

    // Scroll texture diagonally
    bgTexture.offset.x += -0.001;
    bgTexture.offset.y += -0.001;

    // Wavy displacement
    const positions = bgGeometry.attributes.position;
    const time = performance.now()*0.001;
    for(let i=0;i<positions.count;i++){
        const x = positions.getX(i);
        const y = positions.getY(i);
        positions.setZ(i,simplex.noise3d(x*0.18,y*0.18,time*0.3)*1.4);
    }
    positions.needsUpdate = true;

    if (earthPlane) {
        earthPlane.rotation.x += 0.01;  // spin on X-axis
    }

    renderer.render(scene,camera);
    renderer.setPixelRatio(window.devicePixelRatio);
    updateCameraParallax();
}

animate();