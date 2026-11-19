const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const {observe, appearanceFromPixels, createTracker, createZoneLock, findVZone, createMotionGate} =
  require('../../androidapp/app/src/debug/assets/live-golfer-tracking.js');

function golferLandmarks(x=.50, view='side', occluded=false, scale=1) {
  const points = Array(33).fill(null);
  const set = (i,dx,y,visibility=.95) => points[i]={x:x+dx*scale,y:.5+(y-.5)*scale,visibility};
  const front = view==='front';
  const diagonal = view==='diagonal';
  const shoulderWidth = front ? .082 : diagonal ? .048 : .013;
  const hipWidth = front ? .060 : diagonal ? .031 : .011;
  const footWidth = front ? .10 : diagonal ? .045 : .016;
  set(0,front?0:.10,.19);
  set(7,.045,.20);
  set(11,.07-shoulderWidth,.32);
  set(12,.07+shoulderWidth,.32);
  set(23,-hipWidth,.51);
  set(24,hipWidth,.51);
  set(25,.025-footWidth,.64);
  set(26,.025+footWidth,.64);
  set(27,.010-footWidth,.88);
  set(28,.010+footWidth,.88);
  set(15,.135,.57,occluded?.08:.95);
  set(16,.151,.59);
  return points;
}
function golfer(...args) {
  return observe(golferLandmarks(...args),1);
}
function shirt(red, green, blue) {
  const pixels = new Uint8Array(14 * 14 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([red, green, blue, 255], i);
  return appearanceFromPixels(pixels);
}
function through(tracker, a, b, input) {
  let state;
  for (let now=a; now<=b; now+=50) state=tracker.update(input(now),now);
  return state;
}
test('admits a stable golfer, then moves the box with gradual movement', () => {
  const t=createTracker();
  const first=through(t,0,300,()=>golfer());
  assert.equal(first.accepted,true);
  const moving=through(t,350,600,now=>golfer(.50+(now-350)/2100));
  assert.equal(moving.accepted,true);
  assert.ok(moving.box.left > first.box.left+.065);
});
test('loses the old silhouette and reacquires a returning golfer without swapping to a passer', () => {
  const t=createTracker();
  through(t,0,400,()=>golfer());
  const short=t.update(null,500);
  assert.equal(short.phase,'held');
  assert.equal(short.accepted,false);
  const other=through(t,550,1000,()=>golfer(.77,'front',false,.78));
  assert.equal(other.accepted,false);
  assert.equal(other.box,null);
  const reentered=through(t,1050,1400,()=>golfer(.53));
  assert.equal(reentered.accepted,true);
});
test('rejects a similarly placed passer after loss, then reacquires the golfer in 300 ms', () => {
  const blue = shirt(36, 94, 200), dimBlue = shirt(18, 47, 100), red = shirt(211, 38, 48);
  assert.ok(blue && dimBlue && red);
  const t = createTracker(), pose = golfer(), passer = {...golfer(.52), stance:false};
  for (let now=0; now<=400; now+=50) t.update(pose,now,blue);
  const held = t.update(passer,450,red);
  assert.equal(held.phase,'held');
  assert.equal(held.accepted,false);
  for (let now=500; now<=2400; now+=50) assert.equal(t.update(passer,now,red).accepted,false);
  assert.equal(t.update(passer,2450,red).box,null);
  for (let now=2500; now<2800; now+=50) assert.equal(t.update(pose,now,dimBlue).accepted,false);
  assert.equal(t.update(pose,2800,dimBlue).accepted,true);
});

test('accepts a new golfer after a different shirt settles at address', () => {
  const green=shirt(40,174,70), red=shirt(208,48,45);
  assert.equal(shirt(110,108,104),null);
  const t=createTracker(), pose=golfer();
  for (let now=0; now<=350; now+=50) t.update(pose,now,green);
  assert.equal(t.update(null,2200).box,null);
  for (let now=2250; now<2650; now+=50) assert.equal(t.update(pose,now,red).accepted,false);
  assert.equal(t.update(pose,2650,red).accepted,true);
  assert.equal(t.update(pose,2700,green).accepted,false);
});
test('holds a side angle during turn and tolerates a hidden wrist', () => {
  const t=createTracker();
  const a=through(t,0,750,()=>golfer(.50,'side',true));
  assert.equal(a.angle,'side');
  assert.equal(a.address,true);
  assert.equal(a.accepted,true);
  const b=t.update(golfer(.50,'front'),800);
  assert.equal(b.angle,'side');
  assert.equal(b.address,false);
  const ambiguous=createTracker();
  const c=through(ambiguous,0,850,()=>golfer(.50,'diagonal'));
  assert.equal(c.accepted,true);
  assert.equal(c.angle,null);
});
test('can acquire a side address aligned just left of center', () => {
  const t=createTracker();
  const side=through(t,0,800,()=>golfer(.22,'side',true));
  assert.equal(side.angle,'side');
  assert.equal(side.address,true);
});
test('requires agreement, holds a brief pixel miss and clears after loss of evidence', () => {
  const lock=createZoneLock();
  const zone={ball:{x:.72,y:.88},grip:{x:.40,y:.54},neck:{x:.35,y:.27}};
  assert.equal(lock.update(zone,0),null);
  assert.equal(lock.update(zone,150),zone);
  assert.equal(lock.update(null,300),zone);
  assert.equal(lock.update(null,491),null);
  assert.equal(lock.update(zone,550),null);
  lock.reset();
  assert.equal(lock.update(zone,700),null);
});
test('fits a shaft to the bright ball on the shaft side of the golfer', () => {
  const w=320,h=320, pixels=new Uint8Array(w*h*4).fill(50);
  const paint=(x,y,r,rgb)=>{
    for(let row=y-r;row<=y+r;row++)for(let col=x-r;col<=x+r;col++){
      if(Math.hypot(row-y,col-x)>r)continue;
      const i=(row*w+col)*4;
      pixels.set([...rgb,255],i);
    }
  };
  const grip={x:150/320,y:180/320};
  const pose={aspect:1,torso:.24,hip:{x:.36,y:.53},grip,feet:{x:.38,y:.84},shoulder:{x:.43,y:.31}};
  assert.equal(findVZone(pixels,w,h,pose),null);
  for(let t=0;t<1;t+=.005) paint(Math.round(150+72*t),Math.round(180+94*t),1,[211,211,211]);
  paint(222,274,4,[250,247,113]);
  paint(250,266,4,[252,251,115]);
  const found=findVZone(pixels,w,h,pose);
  assert.ok(found);
  assert.ok(Math.hypot(found.ball.x*w-222,found.ball.y*h-274)<5);
  const dimmed=pixels.map((value,index)=>index%4===3?value:Math.round(value*.55));
  const dimZone=findVZone(dimmed,w,h,pose);
  assert.ok(dimZone);
  assert.ok(Math.hypot(dimZone.ball.x*w-222,dimZone.ball.y*h-274)<5);
});

test('blocks a brief hand jitter and requires departure from a settled address', () => {
  const gate=createMotionGate();
  const pose=golfer();
  assert.equal(gate.update(pose,false,0),false);
  assert.equal(gate.update(pose,false,150),false);
  const lifted={...pose,grip:{x:pose.grip.x,y:pose.grip.y-.052}};
  assert.equal(gate.update(lifted,true,200),false);
  assert.equal(gate.update(pose,true,250),false);
  assert.equal(gate.update(lifted,true,300),false);
  assert.equal(gate.update(lifted,true,350),true);
  assert.equal(gate.update(null,true,400),false);
  assert.equal(gate.update(lifted,true,450),false);
});
test('camera callback gates untrusted targets and leaves an active capture alone', async () => {
  const received=[];
  let clock=0, rectangles=0;
  const context={
    clearRect(){}, strokeRect(){rectangles++;}, setLineDash(){},
    fillRect(){}, fillText(){}, measureText(){return {width:40};}
  };
  const rect={width:320,height:320,left:0,top:0};
  const layer={
    style:{},setAttribute(){},getContext(){return context;},getBoundingClientRect(){return rect;}
  };
  const stage={append(){}};
  const sandbox={
    document:{
      getElementById:id=>id==='liveStage'?stage:layer,
      createElement:()=>layer
    },
    performance:{now:()=>clock}, setInterval(){},
    onResults:async result=>{received.push(result.poseLandmarks);},
    poseMotionMetrics:()=>({handSpeed:1}),
    svPoseDisplayPoint:p=>({x:p.x*320,y:p.y*320}),
    svAddressAnalysisLandmarks:p=>p, stream:{}, poseInput:{width:320,height:320},
    armed:true, ready:false, cooldown:false, swingStarted:false, lastPoseRenderAt:0
  };
  sandbox.window=sandbox;
  const source=fs.readFileSync(require.resolve('../../androidapp/app/src/debug/assets/live-golfer-tracking.js'),'utf8');
  vm.runInNewContext(source,sandbox);
  const target=golferLandmarks();
  await sandbox.onResults({poseLandmarks:target});
  assert.equal(received.at(-1),null);
  for(clock=50;clock<=350;clock+=50) await sandbox.onResults({poseLandmarks:target});
  assert.equal(received.at(-1),target);
  assert.ok(rectangles>0);
  const passer=golferLandmarks(.77,'front',false,.78);
  await sandbox.onResults({poseLandmarks:passer});
  assert.equal(received.at(-1),null);
  sandbox.cooldown=true;
  await sandbox.onResults({poseLandmarks:passer});
  assert.equal(received.at(-1),passer);
});
