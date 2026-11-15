import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
window.__marsBoot=1;
const $=id=>document.getElementById(id);
const box=$('terrain3d'),status=$('status'),stage=$('stage'),loading=$('loading');
addEventListener('error',e=>{loading.hidden=false;loading.textContent='Error: '+(e.message||e)});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

// ---------- scene, sky, stars ----------
const scene=new THREE.Scene();scene.background=new THREE.Color(0x03040a);
scene.fog=new THREE.FogExp2(0x0a0710,0.000028);
const camera=new THREE.PerspectiveCamera(55,1,0.3,120000);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));box.appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.495;controls.autoRotate=true;controls.autoRotateSpeed=0.35;controls.addEventListener?.('start',()=>controls.autoRotate=false);controls.minDistance=30;controls.maxDistance=40000;
scene.add(new THREE.HemisphereLight(0xe9f0ff,0x7e3421,1.2));
const sun=new THREE.DirectionalLight(0xffd9b4,1.8);sun.position.set(3000,9000,3000);scene.add(sun);

const stars=(()=>{const n=3500,p=new Float32Array(n*3),c=new Float32Array(n*3),col=new THREE.Color();
  for(let i=0;i<n;i++){const u=Math.random()*2-1,a=Math.random()*Math.PI*2,s=Math.sqrt(1-u*u),R=70000;
    p.set([R*s*Math.cos(a),R*u,R*s*Math.sin(a)],i*3); // upper hemisphere
    col.setHSL(Math.random()<.2?0.08:0.6,0.4,0.65+Math.random()*0.35);c.set([col.r,col.g,col.b],i*3)}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('color',new THREE.BufferAttribute(c,3));
  const m=new THREE.PointsMaterial({size:2.8,sizeAttenuation:false,vertexColors:true,fog:false,transparent:true,depthWrite:false});
  const pts=new THREE.Points(g,m);pts.frustumCulled=false;scene.add(pts);return pts})();
// dark Martian ground beyond the terrain so the horizon looks grounded
const ground=new THREE.Mesh(new THREE.CircleGeometry(60000,48).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0x2a140d}));
ground.position.y=-30;scene.add(ground);

// ---------- state ----------
let mesh=null,width=6820,depth=13535,heights=null,cols=0,rows=0,scaleY=1.5;
const routeData={},lines=[],markers=[];
let saved=null;try{saved=JSON.parse(sessionStorage.getItem('evaSelectedRoute')||'null')}catch{}
const names=['safest','fastest','energy','demo'],colors={safest:0x56e2a2,fastest:0x5eb6ff,energy:0xffad57,demo:0xffe14d};
let mode='orbit',playing=false,walk=null,dist=0,phase=0,flyT=0,flyFrom=null,eyeY=0,lookY=0,last=0;
const BASE=20,EYE=10.0; // metres per second at 1×, eye height (terrain is exaggerated ×1.5)

function resize(){const w=box.clientWidth,h=box.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
addEventListener('resize',resize);new ResizeObserver(resize).observe(box);resize();

// ---------- terrain helpers ----------
function world(row,col,gh=2707,gw=1364){return new THREE.Vector3(((col+.5)/gw-.5)*width,0,((row+.5)/gh-.5)*depth)}
// bilinear height (the JSON heights are already relative to the lowest point)
function surface(x,z,prev=0){
  if(!heights)return prev;
  const fx=clamp((x/width+.5)*(cols-1),0,cols-1.001),fz=clamp((z/depth+.5)*(rows-1),0,rows-1.001);
  const c0=Math.floor(fx),r0=Math.floor(fz),tx=fx-c0,tz=fz-r0;
  let v=[heights[r0][c0],heights[r0][c0+1],heights[r0+1][c0],heights[r0+1][c0+1]];
  const ok=v.filter(q=>q!=null);if(!ok.length)return prev;
  const avg=ok.reduce((a,b)=>a+b,0)/ok.length;v=v.map(q=>q==null?avg:q);
  return ((v[0]*(1-tx)+v[1]*tx)*(1-tz)+(v[2]*(1-tx)+v[3]*tx)*tz)*scaleY;
}

// ---------- camera ----------
function home(){
  mode='orbit';playing=false;controls.enabled=true;controls.autoRotate=true;stage.dataset.pov='0';
  const f=Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*2;
  const D=Math.max(depth*0.78/f,width*1.15/(f*camera.aspect));
  const pitch=THREE.MathUtils.degToRad(52);
  controls.target.set(0,500,depth*0.02);
  camera.position.set(0,500+D*Math.sin(pitch),depth*0.02+D*Math.cos(pitch));
  camera.near=1;camera.far=120000;camera.updateProjectionMatrix();controls.update();
  status.textContent='Camera reset. Drag to rotate, scroll to zoom, right-drag to pan.';
}
$('reset').onclick=home;

// ---------- routes ----------
function mk(color,x,z){const g=new THREE.Group(),y=surface(x,z);
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(4,4,260,10),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.7,fog:false}));beam.position.y=130;
  const ball=new THREE.Mesh(new THREE.SphereGeometry(45,16,12),new THREE.MeshBasicMaterial({color,fog:false}));ball.position.y=270;
  g.add(beam,ball);g.position.set(x,y,z);scene.add(g);markers.push(g)}
function addRoutes(){
  for(const o of lines){scene.remove(o);o.geometry.dispose();o.material.dispose()}lines.length=0;
  for(const m of markers)scene.remove(m);markers.length=0;
  
for(const name of names){
  if(name !== select.value) continue;
  const r=routeData[name];
  if(!r?.path?.length)continue;

    const pts=r.path.map(([a,b])=>{const p=world(a,b,r.gridHeight,r.gridWidth);p.y=surface(p.x,p.z)+9;return p});
   const l = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(pts),
  new THREE.LineBasicMaterial({
    color: colors[name],
    linewidth: 3,
    depthTest: false
  })
);
l.renderOrder = 999;
scene.add(l);
lines.push(l);
    if(name===select.value){mk(0x56e2a2,pts[0].x,pts[0].z);const e=pts[pts.length-1];mk(0xff5a4a,e.x,e.z)}}
}
// smooth the grid path and measure it in metres
function buildWalk(r){
  let p=r.path.map(([a,b])=>world(a,b,r.gridHeight,r.gridWidth)),k=5;
  p=p.map((_,i)=>{let x=0,z=0,n=0;for(let j=Math.max(0,i-k);j<=Math.min(p.length-1,i+k);j++){x+=p[j].x;z+=p[j].z;n++}return new THREE.Vector3(x/n,0,z/n)});
  const d=[0];for(let i=1;i<p.length;i++)d.push(d[i-1]+p[i].distanceTo(p[i-1]));
  return {pts:p,d,total:d[d.length-1]};
}
function at(m){m=clamp(m,0,walk.total);let lo=0,hi=walk.d.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;walk.d[mid]<=m?lo=mid:hi=mid}
  const span=walk.d[hi]-walk.d[lo]||1;return walk.pts[lo].clone().lerp(walk.pts[hi],(m-walk.d[lo])/span)}
let markerGroup=null;
function label(text){const c=document.createElement('canvas');c.width=256;c.height=96;const x=c.getContext('2d');
  x.fillStyle='rgba(8,13,22,.85)';x.fillRect(0,0,256,96);x.strokeStyle='#ffe14d';x.lineWidth=6;x.strokeRect(3,3,250,90);
  x.fillStyle='#ffe14d';x.font='bold 54px Arial';x.textAlign='center';x.textBaseline='middle';x.fillText(text,128,50);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t}
function buildMarkers(){
  if(markerGroup){scene.remove(markerGroup);markerGroup.traverse(o=>{o.material?.map?.dispose();o.material?.dispose();o.geometry?.dispose()})}
  markerGroup=new THREE.Group();const step=walk.total<1500?250:500;
  for(let m=step;m<walk.total-step*0.4;m+=step){
    const p=at(m),y=surface(p.x,p.z);
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(1.3,1.3,30,8),new THREE.MeshBasicMaterial({color:0xffe14d}));pole.position.set(p.x,y+15,p.z);
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:label(m<1000?m+' m':(m/1000)+' km'),fog:false,transparent:true}));
    sp.position.set(p.x,y+44,p.z);sp.userData.marker=true;markerGroup.add(pole,sp)}
  scene.add(markerGroup);
}
function selectRoute(name){
  const r=routeData[name];
  if(!r?.path?.length){status.textContent='That route is not loaded. Plan it in the 2D planner first.';return false}
  walk=buildWalk(r);dist=0;playing=false;if(walk.total>5)buildMarkers();return walk.total>5;
}
function pose(d,smooth,dt){
  const a=at(d);let b=at(d+40);if(a.distanceTo(b)<1)b=a.clone().add(a.clone().sub(at(d-40)));
  const ty=surface(a.x,a.z,eyeY)+EYE+30,ly=surface(b.x,b.z,lookY)+EYE+25;
  if(smooth){eyeY+=(ty-eyeY)*Math.min(1,dt*6);lookY+=(ly-lookY)*Math.min(1,dt*4)}else{eyeY=ty;lookY=ly}
  return {pos:new THREE.Vector3(a.x,eyeY,a.z),look:new THREE.Vector3(b.x,lookY,b.z)};
}
const select=$('route');
select.onchange=()=>{home();if(select.value==='demo'&&!routeData.demo&&heights)routeData.demo=demoRoute();if(selectRoute(select.value))addRoutes()};

// ---------- controls ----------
$('play').onclick=()=>{
  if(!routeData[select.value]){status.textContent='No route loaded. Plan one in the 2D planner and press "Explore selected route in 3D".';return}
  if(!walk||(mode==='walk'&&dist>=walk.total-0.5)){if(!selectRoute(select.value))return}
  if(mode==='walk'){playing=true;status.textContent='Astronaut POV playing';return}
  dist=0;flyFrom={p:camera.position.clone(),t:controls.target.clone()};flyT=0;
  controls.enabled=false;mode='fly';playing=true;status.textContent='Flying to the start point…';
};
$('pause').onclick=()=>{if(mode==='walk'){playing=false;status.textContent='POV paused'}};
$('stop').onclick=home;
const speed=$('speed');speed.oninput=()=>$('speedText').textContent=speed.value+'×';
$('hands').onchange=e=>stage.dataset.hands=e.target.checked?'1':'0';
const handL=$('handL'),handR=$('handR'),hudText=$('hudText'),hudBar=$('hudBar');

// ---------- render loop ----------
function frame(t){
  requestAnimationFrame(frame);const dt=Math.min((t-last)/1000,.08);last=t;
  if(mode==='fly'&&walk){
    flyT=Math.min(1,flyT+dt/1.8);const k=flyT*flyT*(3-2*flyT),p=pose(0,false,dt);
    camera.position.lerpVectors(flyFrom.p,p.pos,k);camera.lookAt(flyFrom.t.clone().lerp(p.look,k));
    if(flyT>=1){mode='walk';stage.dataset.pov='1';status.textContent='Astronaut POV playing'}
  }else if(mode==='walk'&&walk){
    if(playing){const s=Number(speed.value);dist=Math.min(dist+dt*BASE*s,walk.total);phase+=dt*Math.PI*2*1.6*Math.min(s,2.5);
      if(dist>=walk.total){playing=false;status.textContent='Destination reached'}}
    const p=pose(dist,true,dt),bob=Math.abs(Math.sin(phase));
    camera.position.copy(p.pos);camera.position.y+=bob*0.25;camera.lookAt(p.look);
    const s1=Math.sin(phase);
    handL.style.transform=`translateY(${(-bob*10)}px) rotate(${s1*1.8-4}deg)`;
    handR.style.transform=`translateY(${(-(1-bob)*10)}px) rotate(${-s1*1.8+4}deg)`;
    hudText.textContent=`Distance ${Math.round(dist)} / ${Math.round(walk.total)} m  ·  Elevation +${Math.round(p.pos.y/scaleY)} m`;
    hudBar.style.width=(dist/walk.total*100)+'%';
  }else controls.update();
  stars.position.copy(camera.position);ground.position.x=camera.position.x;ground.position.z=camera.position.z;
  for(const l of lines)l.visible=mode==='orbit';
  if(markerGroup)for(const o of markerGroup.children)if(o.userData.marker){const k=clamp(camera.position.distanceTo(o.position)*0.04,40,450);o.scale.set(k*2.2,k*0.83,1)}ground.visible=mode!=='orbit';
  renderer.render(scene,camera);
}
requestAnimationFrame(frame);

// ---------- texture layers ----------
const texLoader=new THREE.TextureLoader(),texCache={},bases=['/images/','../images/','images/'];
async function layer(name,quiet){
  if(!mesh)return;
  try{
    let tex=texCache[name];
    if(!tex){for(const b of bases){try{tex=await texLoader.loadAsync(b+'mars-'+name+'.png');break}catch{}}
      if(!tex)throw Error('missing');tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=renderer.capabilities.getMaxAnisotropy();texCache[name]=tex}
    mesh.material.map=tex;mesh.material.vertexColors=false;mesh.material.color.set(0xffffff);for(const n of ['photo','height','thermal'])$(n).classList.toggle('on',n===name);mesh.material.needsUpdate=true;if(!quiet)status.textContent=name+' terrain layer';
  }catch(e){console.warn('Layer missing: mars-'+name+'.png');if(!quiet)status.textContent='Layer missing: copy mars-'+name+'.png into frontend/images/'}
}
for(const n of ['photo','height','thermal'])$(n).onclick=()=>layer(n);

// ---------- demo route (used when no route came from the 2D planner) ----------
function demoRoute(){
  const find=(fr,fc)=>{const r0=Math.round(fr*(rows-1)),c0=Math.round(fc*(cols-1));
    for(let k=0;k<80;k++)for(let dr=-k;dr<=k;dr++)for(let dc=-k;dc<=k;dc++)
      if(Math.max(Math.abs(dr),Math.abs(dc))===k&&heights[r0+dr]?.[c0+dc]!=null)return [r0+dr,c0+dc];
    return [r0,c0]};
  const a=find(.72,.4),b=find(.38,.6),GH=2707,GW=1364,N=160,path=[];
  for(let i=0;i<=N;i++){const t=i/N,w=Math.sin(t*Math.PI*3)*0.03;
    path.push([((a[0]+(b[0]-a[0])*t)/(rows-1))*(GH-1),((a[1]+(b[1]-a[1])*t)/(cols-1)+w)*(GW-1)])}
  return {path,gridHeight:GH,gridWidth:GW};
}

// ---------- load terrain ----------
async function load(){
  try{
    loading.textContent='Loading Mars terrain…';let d=null;
    for(const u of ['/mars3d/mars3d/terrain.json','mars3d/mars3d/terrain.json','terrain.json','../mars3d/mars3d/terrain.json']){try{const r=await fetch(u);if(r.ok){d=await r.json();break}}catch{}}
    if(!d)throw Error('terrain.json not found');loading.textContent='Building terrain…';await new Promise(r=>setTimeout(r,30));cols=d.width;rows=d.height;heights=d.heights;
    width=d.sourceWidth*d.pixelSizeMeters;depth=d.sourceHeight*d.pixelSizeMeters;
    const g=new THREE.PlaneGeometry(width,depth,cols-1,rows-1);g.rotateX(-Math.PI/2);
    const pos=g.attributes.position;
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const v=heights[r][c];pos.setY(r*cols+c,v==null?0:v*scaleY)}
    const lo=new THREE.Color(0x3a1f1a),mid=new THREE.Color(0xb5683f),hi=new THREE.Color(0xf0d2a8),cc=new Float32Array(cols*rows*3),tmp=new THREE.Color();
    for(let i=0;i<cols*rows;i++){const v=heights[Math.floor(i/cols)][i%cols]??0,t=clamp(v/1500,0,1);t<.5?tmp.copy(lo).lerp(mid,t*2):tmp.copy(mid).lerp(hi,t*2-1);cc.set([tmp.r,tmp.g,tmp.b],i*3)}
    g.setAttribute('color',new THREE.BufferAttribute(cc,3));
    const idx=g.getIndex().array,keep=[],ok=i=>heights[Math.floor(i/cols)][i%cols]!=null;
    for(let i=0;i<idx.length;i+=3)if(ok(idx[i])&&ok(idx[i+1])&&ok(idx[i+2]))keep.push(idx[i],idx[i+1],idx[i+2]);
    g.setIndex(keep);g.computeVertexNormals();
    mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,side:THREE.DoubleSide,roughness:1}));scene.add(mesh);
    home();loading.hidden=true;layer('photo',true);
    if(saved?.path){routeData[saved.name]={path:saved.path,gridHeight:saved.gridHeight,gridWidth:saved.gridWidth};
      select.value=saved.name;addRoutes();selectRoute(saved.name);
      status.textContent='Selected '+saved.name+' route loaded. Press Play POV.'}
    else{select.add(new Option('Demo route (no 2D route yet)','demo'));
      status.textContent='No route yet. In the 2D planner, plan a route and press "Explore selected route in 3D".'}
    loading.hidden=true;
  }catch(e){console.error(e);loading.hidden=false;loading.innerHTML='Could not load <b>terrain.json</b>.<br>Put it in <code>frontend/mars3d/mars3d/</code> (or next to terrain.html) and run the server from <code>frontend/</code>.';home()}
}
load();
