/* T.UP SV MOBILE R15 optional replay V-zone.
 * Additive, test-only control. Sources: existing R15 MediaPipe replay pose,
 * original R15 pixel+shaft detector; READY, SWING and camera capture untouched.
 */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const wrap=document.querySelector('.wrap');
const views={
  front:{stage:$('mainVideoStage'),video:$('replay')},
  side:{stage:$('sideVideoStage'),video:$('sideReplay')}
};
if(!wrap||!views.front.stage||!views.front.video||!views.side.stage||!views.side.video)return;
const frameCanvas=document.createElement('canvas');
const frameContext=frameCanvas.getContext('2d',{willReadFrequently:true});
const states={front:{},side:{}};
let enabled=false;
window.svReplayVZoneEnabled=false; // default OFF; optional live V-zone too
const zoneHelp='실제 공·샤프트 증거를 찾을 때만 녹색 V존을 표시합니다.';

const style=document.createElement('style');
style.id='svR15ReplayVZoneStyle';
style.textContent=`
#svReplayVZoneControl{
 position:fixed;z-index:5200;
 left:clamp(8px,1.1vw,16px);top:calc(env(safe-area-inset-top,0px) + 102px);
 display:inline-flex;align-items:center;gap:7px;max-width:calc(100vw - 20px);
 height:35px;padding:4px 12px 4px 9px;
 border:1px solid rgba(144,170,150,.75);border-radius:9px;
 background:rgba(8,29,20,.87);color:#f2f7f3;
 font:800 13px Arial,'Noto Sans KR',sans-serif;
 box-shadow:0 2px 8px #0007;cursor:pointer;user-select:none;
}
#svReplayVZoneControl input{
 appearance:auto!important;-webkit-appearance:checkbox!important;
 width:18px;height:18px;min-width:18px;margin:0;
 accent-color:#36e97b;cursor:pointer;
}
#svReplayVZoneControl:has(input:checked){border-color:#58ff88;color:#b9ffce}
#svReplayVZoneControl:focus-within{outline:2px solid #a6ffc3;outline-offset:2px}
.svReplayVZoneCanvas{
 position:absolute!important;inset:0!important;width:100%!important;height:100%!important;
 background:transparent!important;z-index:8!important;pointer-events:none!important;
}
@media(max-width:700px){#svReplayVZoneControl{
 top:calc(env(safe-area-inset-top,0px) + 99px);height:33px;padding:3px 8px;
 font-size:12px;}}
`;
document.head.appendChild(style);
const label=document.createElement('label');
label.id='svReplayVZoneControl';label.title=zoneHelp;
const cb=document.createElement('input');cb.type='checkbox';cb.id='svReplayVZoneCheck';cb.checked=false;
cb.setAttribute('aria-label','V존 표시 사용');
const text=document.createElement('span');text.textContent='V존';
label.append(cb,text);document.body.appendChild(label);

for(const key of ['front','side']){
 const view=views[key], state=states[key];
 state.zone=null;state.preview=null;state.prev=null;
 state.lastEvidenceAt=-Infinity;state.lastSampleAt=-Infinity;
 state.lastVideoT=-Infinity;state.lastFrameT=-Infinity;
 state.lastAngle=null;state.lastSrc='';
 state.locked=false;state.count=0;
 const canvas=document.createElement('canvas');
 canvas.id=key==='front'?'svFrontReplayVZoneCanvas':'svSideReplayVZoneCanvas';
 canvas.className='svReplayVZoneCanvas';
 canvas.setAttribute('aria-hidden','true');
 canvas.style.display='none';
 view.stage.append(canvas);state.canvas=canvas;
 // A different recording or imported file must never inherit the previous address V zone.
 for(const ev of ['loadedmetadata','emptied'])view.video.addEventListener(ev,()=>reset(key));
}
function reset(key){
 const s=states[key];s.zone=s.preview=s.prev=null;s.count=0;s.locked=false;
 s.lastEvidenceAt=-Infinity;s.lastVideoT=-Infinity;s.lastFrameT=-Infinity;
 s.lastSampleAt=-Infinity;
 s.canvas.getContext('2d').clearRect(0,0,s.canvas.width,s.canvas.height);
}
function activeView(){
 // If CAM2 side replay is actually visible, use it. A one-camera side shot
 // remains on the left/front replay video, so use that canvas instead.
 const side=views.side.stage;
 if(wrap.classList.contains('dual-camera-active') &&
    getComputedStyle(side).display!=='none' &&
    getComputedStyle($('svSideReplayPanel')).display!=='none')return 'side';
 return 'front';
}
function wants(key){
 if(!enabled || !wrap.classList.contains('replay-mode') || activeView()!==key)return false;
 const s=states[key],v=views[key].video;
 if(!v.videoWidth || v.readyState<2)return false;
 const deg=Number(key==='front'?window.svFrontRotation:window.svSideRotation) || 0;
 if(s.lastAngle!==null&&deg!==s.lastAngle){reset(key);}
 if(s.locked)return false;
 if(v.paused && Math.abs(v.currentTime-s.lastFrameT)<.04 && s.count>=1)return false;
 return true;
}
function onPose(key,landmarks,input){
 if(!wants(key) || !landmarks || !input || !input.width || !input.height)return;
 const s=states[key],v=views[key].video;
 const now=performance.now();
 if(now-s.lastSampleAt<180)return;
 s.lastSampleAt=now;
 s.lastAngle=Number(key==='front'?window.svFrontRotation:window.svSideRotation)||0;
 s.lastFrameT=v.currentTime;
 const api=window.svPcReplayZoneAPI;
 if(!api)return;
 const targetW=Math.max(1,Math.round(Math.min(1,480/Math.max(input.width,input.height))*input.width));
 const targetH=Math.max(1,Math.round(input.height*targetW/input.width));
 if(frameCanvas.width!==targetW||frameCanvas.height!==targetH){frameCanvas.width=targetW;frameCanvas.height=targetH;}
 const pose=api.observe(landmarks,targetW/targetH);
 // For one-camera recordings, refuse to fabricate a SIDE measurement from a FRONT pose.
 if(!pose?.stance || (key==='front' && pose.angle!=='side'))return;
 let evidence=null;
 try{
   frameContext.drawImage(input,0,0,targetW,targetH);
   const rgba=frameContext.getImageData(0,0,targetW,targetH).data;
   const found=api.findVZone(rgba,targetW,targetH,pose);
   // Shaft-only is visibly marked as an ESTIMATE, never a measured ball.
   evidence=found?{...found,source:'ball+shaft'}:
     api.findShaftZone(rgba,targetW,targetH,pose);
 }catch(e){console.warn('[SV replay V-zone] pixel read unavailable',e);return;}
 if(!evidence)return;
 const dt=now-s.lastEvidenceAt;
 const prev=s.prev;
 const d=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 const matches=prev && dt<=600 && d(prev.ball,evidence.ball)<.025 &&
               d(prev.grip,evidence.grip)<.055 && prev.source===evidence.source &&
               Math.abs(v.currentTime-s.lastVideoT)>=.045;
 s.count=matches?s.count+1:1;
 s.prev=evidence;s.preview=evidence;
 s.lastEvidenceAt=now;s.lastVideoT=v.currentTime;
 // A confirmed ball+shaft zone replaces shaft-only estimates whenever available.
 if(s.count>=2 && (!s.zone || evidence.source==='ball+shaft' || s.zone.source==='shaft')){
   s.zone=evidence;s.locked=evidence.source==='ball+shaft';
 }
}
function paint(key){
 const s=states[key],v=views[key],canvas=s.canvas;
 const angle=Number(key==='front'?window.svFrontRotation:window.svSideRotation)||0;
 if(s.lastAngle!==null && angle!==s.lastAngle)reset(key);
 const visible=enabled && wrap.classList.contains('replay-mode') && activeView()===key;
 if(!visible){if(canvas.style.display!=='none')canvas.style.display='none';return;}
 canvas.style.display='block';
 const rect=v.stage.getBoundingClientRect();
 const w=Math.max(1,Math.round(rect.width)),h=Math.max(1,Math.round(rect.height));
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 const x=canvas.getContext('2d');x.clearRect(0,0,w,h);
 const zone=s.zone || s.preview;
 if(!v.video.videoWidth||!v.video.videoHeight)return;
 const deg=Number(key==='front'?window.svFrontRotation:window.svSideRotation)||0;
 const rot=deg%180!==0;
 const iw=rot?v.video.videoHeight:v.video.videoWidth;
 const ih=rot?v.video.videoWidth:v.video.videoHeight;
 const scale=Math.min(w/iw,h/ih);
 const ox=(w-iw*scale)/2,oy=(h-ih*scale)/2;
 if(zone){
   const p=a=>({x:ox+a.x*iw*scale,y:oy+a.y*ih*scale});
   const ball=p(zone.ball),grip=p(zone.grip),neck=p(zone.neck);
   const lower={x:ball.x+2.7*(grip.x-ball.x),y:ball.y+2.7*(grip.y-ball.y)};
   const upper={x:ball.x+1.8*(neck.x-ball.x),y:ball.y+1.8*(neck.y-ball.y)};
   x.save();x.lineJoin='round';x.lineCap='round';
   x.beginPath();x.moveTo(lower.x,lower.y);x.lineTo(ball.x,ball.y);x.lineTo(upper.x,upper.y);
   if(zone.source==='ball+shaft'){
     x.fillStyle='rgba(67,255,115,.13)';x.fill();x.strokeStyle='#58ff88';x.lineWidth=2.3;
   }else{
     x.strokeStyle='#9ce8b1';x.lineWidth=1.65;x.setLineDash([6,5]);
   }
   x.stroke();x.setLineDash([]);
   const caption=zone.source==='ball+shaft'?
     (s.locked?'V존 · 공+샤프트 확인':'V존 · 공+샤프트 확인 중'):
     'V존 참고 · 샤프트 확인 / 공 위치 추정';
   x.font='700 12px Arial,sans-serif';
   const boxW=Math.min(w-12,x.measureText(caption).width+16);
   x.fillStyle='rgba(8,28,20,.86)';x.fillRect(6,9,boxW,24);
   x.fillStyle=zone.source==='ball+shaft'?'#98ffb9':'#fff0a0';
   x.fillText(caption,12,26);
   x.restore();
 }else{
   x.fillStyle='rgba(8,28,20,.76)';x.fillRect(6,9,180,24);
   x.font='700 12px Arial,sans-serif';x.fillStyle='#fff0a0';
   x.fillText('V존 · 어드레스 분석 중',12,26);
 }
}
function tick(t){
 if(enabled){
   const active=activeView();
   paint(active);
   const other=active==='front'?'side':'front';
   states[other].canvas.style.display='none';
 }
 requestAnimationFrame(tick);
}
cb.addEventListener('change',()=>{
 enabled=cb.checked;window.svReplayVZoneEnabled=enabled;
 if(!enabled){
   for(const key of ['front','side']){
     const s=states[key];s.canvas.style.display='none';
     s.canvas.getContext('2d').clearRect(0,0,s.canvas.width,s.canvas.height);
   }
 }else{
   for(const key of ['front','side']){
     const s=states[key];s.lastSampleAt=-Infinity;
   }
 }
 // Geometry and READY/SWING operate independently of this checkbox.
});
window.svReplayVZone=Object.freeze({wants,onPose,activeView,isEnabled:()=>enabled,reset});
requestAnimationFrame(tick);
})();