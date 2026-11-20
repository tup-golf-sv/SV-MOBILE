((root) => {
  'use strict';

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = require('../../../../../sv-r15-mobile-core.js');
    return;
  }
  const tracker = root.svMobileR15;
  const evidence = root.svPcReplayZoneAPI;
  const stage = document.getElementById('liveStage');
  const baseCanvas = document.getElementById('view');
  if (!tracker || !evidence || !stage || !baseCanvas || typeof root.onResults !== 'function') return;

  const layer = document.createElement('canvas');
  layer.id = 'svGolferTracker';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';
  stage.append(layer);
  const overlay = layer.getContext('2d');
  const pixels = document.createElement('canvas');
  const pixelContext = pixels.getContext('2d', {willReadFrequently:true});
  const vzone = evidence.createZoneLock();
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let latest = null, zone = null, sampleAt = -Infinity;
  const original = root.onResults;

    function screen(point, rect, cameraRect) {
      const p = svPoseDisplayPoint(point);
      return {x:p.x + cameraRect.left - rect.left, y:p.y + cameraRect.top - rect.top};
    }
    function paint() {
      const rect = layer.getBoundingClientRect();
      const w = Math.round(rect.width), h = Math.round(rect.height);
      if (!w || !h) return;
      if (layer.width !== w) layer.width = w;
      if (layer.height !== h) layer.height = h;
      overlay.clearRect(0,0,w,h);
      if (!latest?.box || cooldown || swingStarted) return;
      const cameraRect = baseCanvas.getBoundingClientRect();
      const map = p => screen(p,rect,cameraRect);
      const b = latest.box;
      const corners = [map({x:b.left,y:b.top}), map({x:b.right,y:b.top}),
        map({x:b.left,y:b.bottom}), map({x:b.right,y:b.bottom})];
      if (!corners.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return;
      const x = clamp(Math.min(...corners.map(p=>p.x)),2,w-2), y = clamp(Math.min(...corners.map(p=>p.y)),2,h-2);
      const r = clamp(Math.max(...corners.map(p=>p.x)),2,w-2), d = clamp(Math.max(...corners.map(p=>p.y)),2,h-2);
      if (r <= x || d <= y) return;
      overlay.strokeStyle = latest.accepted ? '#8cffab' : '#ffe089';
      overlay.setLineDash(latest.accepted ? [] : [5,5]);
      overlay.lineWidth = 2;
      overlay.strokeRect(x,y,r-x,d-y);
      overlay.setLineDash([]);
      const label = latest.phase === 'held' ? '골퍼 다시 확인 중' : !latest.accepted ? '골퍼 확인 중' :
        latest.angle === 'side' ? '측면' : latest.angle === 'front' ? '정면' : '각도 확인 중';
      overlay.font = '600 12px sans-serif';
      const labelY = y >= 21 ? y-18 : y+3;
      overlay.fillStyle = '#10291e';
      overlay.fillRect(x,labelY,overlay.measureText(label).width+12,17);
      overlay.fillStyle = '#eafff1';
      overlay.fillText(label,x+6,labelY+12);
      if (!zone) return;
      const ball = map(zone.ball), grip = map(zone.grip), neck = map(zone.neck);
      const lower = {x:ball.x+2.7*(grip.x-ball.x),y:ball.y+2.7*(grip.y-ball.y)};
      const upper = {x:ball.x+1.8*(neck.x-ball.x),y:ball.y+1.8*(neck.y-ball.y)};
      overlay.beginPath();
      overlay.moveTo(lower.x,lower.y); overlay.lineTo(ball.x,ball.y); overlay.lineTo(upper.x,upper.y);
      overlay.fillStyle = 'rgba(67,255,115,.16)';
      overlay.fill();
      overlay.strokeStyle = '#58ff88';
      overlay.lineWidth = 2.2;
      overlay.stroke();
    }


  function clearZone() {
    if (zone || sampleAt !== -Infinity) vzone.reset();
    zone = null;
    sampleAt = -Infinity;
  }

  root.onResults = async function(results) {
    await original(results);
    if (!stream || svPoseRotation !== (root.svPreviewRotationDeg ?? svDefaultPoseRotation)) return;
    const observed = tracker.liveObservation();
    latest = observed.tracking;
    if (latest?.address && latest.angle === 'side' && observed.pose && !cooldown && !swingStarted) {
      const now = performance.now();
      if (now - sampleAt >= 140) {
        sampleAt = now;
        const scale = Math.min(1,480/Math.max(poseInput.width,poseInput.height));
        const width = Math.max(1,Math.round(poseInput.width*scale));
        const height = Math.max(1,Math.round(poseInput.height*scale));
        if (pixels.width !== width) pixels.width = width;
        if (pixels.height !== height) pixels.height = height;
        try {
          pixelContext.drawImage(poseInput,0,0,width,height);
          const frame = pixelContext.getImageData(0,0,width,height).data;
          zone = vzone.update(evidence.findVZone(frame,width,height,observed.pose),now);
        } catch (error) {
          clearZone();
        }
      }
    } else {
      clearZone();
    }
    paint();
  };

  setInterval(() => {
    if ((latest || zone) && (!stream || performance.now() - lastPoseRenderAt > 420)) {
      latest = null;
      clearZone();
      paint();
    }
  },150);
})(typeof window === 'undefined' ? null : window);
