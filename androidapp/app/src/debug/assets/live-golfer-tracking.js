((root) => {
  'use strict';

  const HOLD_MS = 420;
  const REACQUIRE_MS = 1800;
  const ACQUIRE_MS = 260;
  const ADDRESS_MS = 360;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({x:(a.x + b.x) / 2, y:(a.y + b.y) / 2});
  const mix = (a, b, amount) => a + (b - a) * amount;

  function observe(landmarks, aspect) {
    if (!landmarks || !Number.isFinite(aspect) || aspect <= 0) return null;
    const point = (i, confidence = .50) => {
      const p = landmarks[i];
      return p && (p.visibility ?? 0) >= confidence &&
        p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
        ? {x:p.x * aspect, y:p.y} : null;
    };
    const ls = point(11), rs = point(12), lh = point(23), rh = point(24);
    if (!ls || !rs || !lh || !rh) return null;
    const shoulder = mid(ls, rs), hip = mid(lh, rh), torso = distance(shoulder, hip);
    if (torso < .09 || hip.y - shoulder.y < .055) return null;
    const lk = point(25, .40), rk = point(26, .40);
    const la = point(27, .40), ra = point(28, .40);
    const head = [point(0, .42), point(7, .42), point(8, .42)].filter(Boolean);
    if (!head.length || (!lk && !rk) || (!la && !ra)) return null;
    const knee = lk && rk ? mid(lk, rk) : lk || rk;
    const feet = la && ra ? mid(la, ra) : la || ra;
    if (feet.y - shoulder.y < .25 || feet.y - hip.y < .13) return null;

    const points = [ls, rs, lh, rh, lk, rk, la, ra, ...head].filter(Boolean);
    const box = {
      left:clamp((Math.min(...points.map(p => p.x)) - .24 * torso) / aspect, 0, 1),
      right:clamp((Math.max(...points.map(p => p.x)) + .24 * torso) / aspect, 0, 1),
      top:clamp(Math.min(...points.map(p => p.y)) - .20 * torso, 0, 1),
      bottom:clamp(Math.max(...points.map(p => p.y)) + .10 * torso, 0, 1)
    };
    const shoulderWidth = Math.abs(ls.x - rs.x) / torso;
    const hipWidth = Math.abs(lh.x - rh.x) / torso;
    const feetWidth = la && ra ? Math.abs(la.x - ra.x) / torso : null;
    const angle = shoulderWidth <= .34 && hipWidth <= .23
      && (feetWidth === null ? shoulderWidth <= .20 && hipWidth <= .15 : feetWidth <= .45)
      ? 'side' : shoulderWidth >= .54 && hipWidth >= .28 && (feetWidth ?? 0) >= .46
      ? 'front' : null;
    const wrists = [point(15, .58), point(16, .58)];
    const grip = wrists.every(Boolean) ? mid(...wrists) : wrists.find(Boolean) || null;
    const bend = Math.abs(shoulder.x - hip.x) / torso;
    const handsTogether = wrists.every(Boolean) ? distance(...wrists) <= .58 * torso : !!grip;
    const stance = !!grip && handsTogether && grip.y - shoulder.y >= .60 * torso
      && grip.y - shoulder.y <= 2.35 * torso && knee.y >= hip.y + .24 * torso
      && feet.y >= knee.y + .30 * torso && (angle !== 'side' || bend >= .16);
    return {aspect, box, hip, torso, shoulder, feet, wrists, grip, angle, stance, shoulderWidth, hipWidth, feetWidth};
  }

  function createTracker() {
    let target, candidate, silhouette, heldAngle, address, trackedAt = 0, stanceReady = false;
    function reset() {
      target = candidate = silhouette = heldAngle = address = null;
      trackedAt = 0;
      stanceReady = false;
    }
    function close(first, second, speed) {
      const ratio = second.torso / first.torso;
      return ratio >= .69 && ratio <= 1.46 && distance(first.hip, second.hip) <= first.torso * speed
        && Math.abs((first.feet.y - first.hip.y) / first.torso
                  - (second.feet.y - second.hip.y) / second.torso) < .90;
    }
    function insideTee(pose) {
      const hipX = pose.hip.x / pose.aspect;
      if (hipX >= .26 && hipX <= .74) return true;
      const gripX = pose.grip?.x / pose.aspect;
      return pose.angle === 'side' && pose.stance && pose.torso >= .135
        && hipX >= .16 && hipX <= .84 && gripX >= .30 && gripX <= .70;
    }
    function update(pose, now) {
      const age = target ? now - trackedAt : Infinity;
      if (age > REACQUIRE_MS && target) reset();
      const same = target && pose && close(target, pose, .42 + Math.min(age, HOLD_MS) / 700);
      let observed = false;
      if (same && age <= HOLD_MS) {
        target = pose;
        trackedAt = now;
        observed = true;
      } else if (pose && (!target ? insideTee(pose) : same)) {
        if (!candidate || now - candidate.last > HOLD_MS || !close(candidate.origin, pose, .56)) {
          candidate = {origin:pose, since:now, last:now, count:0};
        }
        candidate.last = now;
        candidate.count++;
        if (now - candidate.since >= ACQUIRE_MS && candidate.count >= 3) {
          target = pose;
          silhouette = null;
          trackedAt = now;
          observed = true;
        }
      } else {
        candidate = null;
      }
      if (observed) {
        candidate = null;
        silhouette = silhouette ? Object.fromEntries(Object.keys(pose.box).map(
          key => [key, mix(silhouette[key], pose.box[key], .50)])) : pose.box;
        if (pose.stance && pose.angle) {
          if (!address || now - address.last > HOLD_MS || address.angle !== pose.angle ||
              distance(address.hip, pose.hip) > pose.torso * .24 ||
              distance(address.grip, pose.grip) > pose.torso * .25) {
            address = {angle:pose.angle, since:now, last:now, hip:pose.hip, grip:pose.grip, count:0};
          }
          address.last = now;
          address.count++;
          stanceReady = address.count >= 4 && now - address.since >= ADDRESS_MS;
          if (stanceReady && !heldAngle) heldAngle = address.angle;
        } else {
          address = null;
          stanceReady = false;
        }
      } else {
        address = null;
        stanceReady = false;
        if (age > HOLD_MS) {
          heldAngle = null;
          silhouette = null;
        }
      }
      const phase = observed ? 'tracked' : target && age <= HOLD_MS ? 'held' : candidate ? 'acquiring' : 'searching';
      return {phase, accepted:observed, angle:heldAngle, address:observed && stanceReady && heldAngle === pose.angle,
        box:silhouette || candidate?.origin.box || null};
    }
    return {update, reset};
  }

  function createMotionGate() {
    let anchor, start, previous, stationary, checkpoint;
    function update(pose, ready, now) {
      if (!pose?.grip) {
        anchor = start = previous = stationary = checkpoint = null;
        return false;
      }
      const relative = {
        x:(pose.grip.x-pose.hip.x)/pose.torso,
        y:(pose.grip.y-pose.hip.y)/pose.torso
      };
      if (previous !== null && now-previous > HOLD_MS) {
        anchor = start = stationary = checkpoint = null;
      }
      previous = now;
      if (!ready) {
        anchor = start = null;
        if (!pose.stance || relative.y < -.28) stationary = null;
        else {
          if (!stationary || distance(stationary.relative,relative) > .17) {
            stationary = {relative, since:now};
          }
          if (now-stationary.since >= 150) checkpoint = {relative:stationary.relative, seen:now};
        }
        return false;
      }
      if (!anchor && checkpoint && now-checkpoint.seen <= 4000) anchor = checkpoint.relative;
      if (!anchor) return false;
      const rise = anchor.y-relative.y;
      const lateral = Math.abs(relative.x-anchor.x);
      const departure = (rise >= .10 && distance(anchor,relative) >= .21) || lateral >= .37;
      if (!departure) start = null;
      else if (start === null) start = now;
      return start !== null && now-start >= 45;
    }
    return {update};
  }

  function findVZone(pixels, width, height, pose) {
    if (!pose?.grip || !pixels || pixels.length !== width * height * 4) return null;
    const toPixel = p => ({x:p.x / pose.aspect * width, y:p.y * height});
    const grip = toPixel(pose.grip), neck = toPixel(pose.shoulder), feet = toPixel(pose.feet);
    const torso = pose.torso * height;
    if (torso < 18 || grip.y >= feet.y - .24 * torso) return null;
    const at = (x, y) => {
      const i = (Math.round(y) * width + Math.round(x)) * 4;
      return (77 * pixels[i] + 150 * pixels[i + 1] + 29 * pixels[i + 2]) / 256;
    };
    const ballCandidates = [];
    const sign = Math.sign(pose.grip.x - pose.hip.x);
    const radius = clamp(Math.round(torso * .055), 2, 5);
    const yMin = Math.max(radius * 2 + 1, Math.floor(feet.y - .24 * torso));
    const yMax = Math.min(height - radius * 2 - 2, Math.ceil(feet.y + .44 * torso));
    const xMin = Math.max(radius * 2 + 1, Math.floor(grip.x - 1.65 * torso));
    const xMax = Math.min(width - radius * 2 - 2, Math.ceil(grip.x + 1.65 * torso));
    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) {
        if (Math.abs(x - grip.x) < .20 * torso || (sign && (x - grip.x) * sign < 0)) continue;
        const i = (y * width + x) * 4;
        const red = pixels[i], green = pixels[i+1], blue = pixels[i+2];
        const spread = Math.max(red,green,blue) - Math.min(red,green,blue);
        const white = Math.min(red,green,blue) >= 156 && spread <= 55;
        const yellow = red >= 158 && green >= 148 && red - blue >= 42 && green - blue >= 42
          && red >= green * .86;
        const luma = at(x, y);
        if (luma < 150 || (!white && !yellow)) continue;
        const near = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
        const inner = Math.max(2, Math.floor(radius*.6));
        const diagonal = Math.max(1,Math.round(inner*.707));
        const innerRing = [at(x-inner,y),at(x+inner,y),at(x,y-inner),at(x,y+inner),
          at(x-diagonal,y-diagonal),at(x+diagonal,y-diagonal),
          at(x-diagonal,y+diagonal),at(x+diagonal,y+diagonal)];
        if (innerRing.filter(v => v >= luma - 55).length < (yellow ? 4 : 6)) continue;
        const ring = Math.ceil(radius * 1.36);
        const far = [at(x - ring, y), at(x + ring, y), at(x, y - ring), at(x, y + ring),
          at(x - radius, y - radius), at(x + radius, y - radius),
          at(x - radius, y + radius), at(x + radius, y + radius)];
        const brightCore = (luma * 2 + near.reduce((a, b) => a + b, 0)) / 6;
        if (far.filter(v => brightCore - v >= 20).length < 6) continue;
        const score = brightCore - far.reduce((a, b) => a + b, 0) / far.length;
        ballCandidates.push({x, y, score:score + .25*luma});
      }
    }
    ballCandidates.sort((a, b) => b.score - a.score);
    const distinct = [];
    for (const ball of ballCandidates) {
      if (distinct.every(other => distance(ball,other) > radius+1)) distinct.push(ball);
      if (distinct.length >= 20) break;
    }
    function shaftSupport(top, end) {
      const dx = end.x - top.x, dy = end.y - top.y, len = Math.hypot(dx,dy);
      if (len < .70 * torso || dy <= .55 * len) return 0;
      const nx = dy / len, ny = -dx / len;
      const offset = clamp(torso * .035, 2.5, 4);
      let light = 0, dark = 0, contrast = 0, strongest = 0, chain = 0, previous = 0;
      for (let i = 0; i < 18; i++) {
        const t = .17 + .67 * i / 17;
        const x = top.x + t * dx, y = top.y + t * dy;
        if (x < 6 || x >= width - 6 || y < 6 || y >= height - 6) return 0;
        const left = at(x + nx * offset,y + ny * offset);
        const right = at(x - nx * offset,y - ny * offset);
        const center = at(x,y), a = at(x+nx*.85,y+ny*.85), b = at(x-nx*.85,y-ny*.85);
        const hi = Math.max(center,a,b) - Math.max(left,right);
        const lo = Math.min(left,right) - Math.min(center,a,b);
        const polarity = Math.max(hi,lo) < 11 ? 0 : hi >= lo ? 1 : -1;
        if (!polarity) { chain=0; previous=0; continue; }
        chain = polarity === previous ? chain + 1 : 1;
        strongest = Math.max(strongest,chain);
        previous = polarity;
        if (polarity > 0) light++;
        else dark++;
        contrast += Math.min(Math.max(hi,lo),75);
      }
      const consistent = Math.max(light,dark);
      return consistent >= 10 && strongest >= 5 ? contrast + 26*consistent : 0;
    }
    const finalists = [];
    for (const ball of distinct) {
      let bestShaft = null;
      for (const shiftX of [-.12,-.07,-.035,0,.035,.07,.12]) {
        for (const shiftY of [0,.09,.17]) {
          const top = {x:grip.x+shiftX*torso,y:grip.y+shiftY*torso};
          for (const headX of [-.065,0,.065]) {
            const end = {x:ball.x+headX*torso,y:ball.y+Math.abs(headX)*.65*torso};
            const support = shaftSupport(top,end);
            if (!support) continue;
            const penalty = 140*(Math.abs(shiftX)+.4*shiftY+1.5*Math.abs(headX));
            const score = support-penalty;
            if (!bestShaft || score > bestShaft.score) bestShaft = {top,end,score};
          }
        }
      }
      if (!bestShaft) continue;
      const {top,end,score} = bestShaft;
      const direction = {x:ball.x+top.x-end.x,y:ball.y+top.y-end.y};
      const spread = Math.abs(Math.atan2(direction.y-ball.y,direction.x-ball.x)
        - Math.atan2(neck.y-ball.y,neck.x-ball.x));
      if (spread >= .07 && spread <= .95) finalists.push({ball,direction,score:score+4*ball.score});
    }
    finalists.sort((a, b) => b.score - a.score);
    const best = finalists[0];
    if (!best || finalists.some(f => f.score >= .88 * best.score
                && distance(f.ball,best.ball) > Math.max(radius * 2,torso * .14))) return null;
    const norm = p => ({x:p.x/width,y:p.y/height});
    return {ball:norm(best.ball),grip:norm(best.direction),neck:norm(neck)};
  }

  function createZoneLock() {
    let previous, lastEvidence, current, count;
    function reset() {
      previous = current = null;
      lastEvidence = -Infinity;
      count = 0;
    }
    reset();
    function update(zone, now) {
      if (!zone) {
        if (current && now-lastEvidence <= 340) return current;
        if (now-lastEvidence > 340) reset();
        return null;
      }
      const matches = previous && now-lastEvidence <= 340
        && distance(previous.ball,zone.ball) < .020 && distance(previous.grip,zone.grip) < .048;
      count = matches ? count+1 : 1;
      current = count >= 2 ? zone : null;
      previous = zone;
      lastEvidence = now;
      return current;
    }
    return {update,reset};
  }

  function install() {
    if (typeof root.onResults !== 'function' || typeof root.poseMotionMetrics !== 'function' ||
        typeof svPoseDisplayPoint !== 'function') return;
    const stage = document.getElementById('liveStage');
    const baseCanvas = document.getElementById('view');
    if (!stage || !baseCanvas) return;
    const layer = document.createElement('canvas');
    layer.id = 'svGolferTracker';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';
    stage.append(layer);
    const overlay = layer.getContext('2d');
    const pixels = document.createElement('canvas');
    const pixelContext = pixels.getContext('2d', {willReadFrequently:true});
    const tracking = createTracker();
    const motion = createMotionGate();
    const vzone = createZoneLock();
    let camera = null, latest = null, zone = null, sampleAt = -Infinity, normalizesPortrait = false;
    const original = root.onResults;
    const originalMetrics = root.poseMotionMetrics;
    let confirmedMotion = false;
    root.poseMotionMetrics = function(lm, now) {
      const metrics = originalMetrics(lm,now);
      if (armed && ready && !cooldown && !swingStarted && !confirmedMotion) metrics.handSpeed = 0;
      return metrics;
    };

    function screen(point, rect, cameraRect) {
      const p = svPoseDisplayPoint(normalizesPortrait ? {x:1-point.y,y:point.x} : point);
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

    root.onResults = function(results) {
      if (!stream || stream !== camera) {
        tracking.reset();
        latest = zone = null;
        vzone.reset();
        motion.update(null,false,0);
        sampleAt = -Infinity;
        camera = stream;
      }
      if (!stream) { paint(); return original(results); }
      const now = performance.now();
      const aligned = svAddressAnalysisLandmarks(results.poseLandmarks);
      if (aligned && normalizesPortrait !== (aligned !== results.poseLandmarks)) {
        normalizesPortrait = aligned !== results.poseLandmarks;
        tracking.reset();
        vzone.reset();
        zone = null;
      }
      const image = normalizesPortrait ? raw : poseInput;
      const imageW = normalizesPortrait ? raw.videoWidth : poseInput.width;
      const imageH = normalizesPortrait ? raw.videoHeight : poseInput.height;
      const poseFrame = observe(aligned,imageW/imageH);
      latest = tracking.update(poseFrame,now);
      confirmedMotion = motion.update(latest.accepted && armed && !cooldown ? poseFrame : null,ready,now);
      if (latest.address && latest.angle === 'side' && !cooldown && !swingStarted && imageW && imageH) {
        if (now - sampleAt >= 140) {
          sampleAt = now;
          const scale = Math.min(1,480/Math.max(imageW,imageH));
          pixels.width = Math.max(1,Math.round(imageW*scale));
          pixels.height = Math.max(1,Math.round(imageH*scale));
          try {
            pixelContext.drawImage(image,0,0,pixels.width,pixels.height);
            const rgba = pixelContext.getImageData(0,0,pixels.width,pixels.height).data;
            zone = vzone.update(findVZone(rgba,pixels.width,pixels.height,poseFrame),now);
          } catch {
            vzone.reset();
            zone = null;
          }
        }
      } else {
        vzone.reset();
        zone = null;
      }
      const pass = !armed || cooldown || swingStarted || latest.accepted;
      const result = original(pass ? results : {...results,poseLandmarks:null});
      paint();
      return result;
    };

    setInterval(() => {
      if (!latest || !stream || performance.now()-lastPoseRenderAt > HOLD_MS) {
        if (latest || camera) {
          if (!stream) { tracking.reset(); camera = null; }
          latest = zone = null;
          vzone.reset();
          paint();
        }
      }
    },150);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {observe,createTracker,findVZone,createZoneLock,createMotionGate};
  } else {
    install();
  }
})(typeof window === 'undefined' ? null : window);
