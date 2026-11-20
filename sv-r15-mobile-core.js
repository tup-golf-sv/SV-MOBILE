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

  function observe(landmarks, aspect, live = false) {
    if (!landmarks || !Number.isFinite(aspect) || aspect <= 0) return null;
    const point = (i, confidence = .50) => {
      const p = landmarks[i];
      return p && (p.visibility ?? 0) >= confidence &&
        p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
        ? {x:p.x * aspect, y:p.y} : null;
    };
    const torsoConfidence = live ? .20 : .50;
    const ls = point(11, torsoConfidence), rs = point(12, torsoConfidence);
    const lh = point(23, torsoConfidence), rh = point(24, torsoConfidence);
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
    if (live && ![11,12,23,24].every(i => point(i, .35))) {
      // In profile, the far shoulder and hip can be partially hidden. Require
      // a well-observed shoulder, hip, knee and ankle on the same visible side.
      const visibleSide = (point(11) && point(23) && lk && la)
        || (point(12) && point(24) && rk && ra);
      if (angle !== 'side' || !visibleSide) return null;
    }
    const wrists = [point(15, .58), point(16, .58)];
    const grip = wrists.every(Boolean) ? mid(...wrists) : wrists.find(Boolean) || null;
    const bend = Math.abs(shoulder.x - hip.x) / torso;
    const handsTogether = wrists.every(Boolean) ? distance(...wrists) <= .58 * torso : !!grip;
    const stance = !!grip && handsTogether && grip.y - shoulder.y >= .60 * torso
      && grip.y - shoulder.y <= 2.35 * torso && knee.y >= hip.y + .24 * torso
      && feet.y >= knee.y + .30 * torso && (angle !== 'side' || bend >= .16);
    return {aspect, box, hip, torso, shoulder, feet, wrists, grip, angle, stance, shoulderWidth, hipWidth, feetWidth};
  }

  function torsoRegion(pose, width, height) {
    const torso = pose.torso * height;
    const w = (.35 + .23 * Math.min(1, pose.shoulderWidth)) * torso;
    const h = .32 * torso;
    const x = mix(pose.shoulder.x, pose.hip.x, .46) * width / pose.aspect - w / 2;
    const y = mix(pose.shoulder.y, pose.hip.y, .46) * height - h / 2;
    return x >= 0 && y >= 0 && x + w <= width && y + h <= height && w >= 5 && h >= 5
      ? {x, y, w, h} : null;
  }

  function appearanceFromPixels(rgba) {
    const bins = Array(12).fill(0);
    let count = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const max = Math.max(r, g, b), chroma = max - Math.min(r, g, b);
      if (max < 45 || chroma < Math.max(16, .24 * max)) continue;
      const hue = max === r ? (g - b) / chroma : max === g ? 2 + (b - r) / chroma : 4 + (r - g) / chroma;
      const position = (2 * hue + 12) % 12, index = Math.floor(position);
      bins[index] += 1 - (position - index);
      bins[(index + 1) % 12] += position - index;
      count++;
    }
    if (count < .56 * rgba.length / 4 || !count) return null;
    const peak = bins.indexOf(Math.max(...bins));
    const neighborWeight = bins[peak] + bins[(peak + 1) % 12] + bins[(peak + 11) % 12];
    return neighborWeight >= .73 * count ? bins.map(value => value / count) : null;
  }

  function compatibleAppearance(a, b) {
    if (!a || !b) return true;
    const difference = a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0);
    if (difference <= 1.20) return true;
    // Adjacent hue bins can trade weight under a change in white balance.
    const overlap = a.reduce((sum, value, i) =>
      sum + Math.min(value, b[i] + b[(i + 1) % 12] + b[(i + 11) % 12]), 0);
    return overlap >= .55;
  }

  function createTracker() {
    let target, targetAppearance, candidate, silhouette, heldAngle, address, trackedAt = 0, stanceReady = false;
    function reset() {
      target = targetAppearance = candidate = silhouette = heldAngle = address = null;
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
    function update(pose, now, appearance) {
      const age = target ? now - trackedAt : Infinity;
      if (age > REACQUIRE_MS && target) {
        const previousAppearance = targetAppearance;
        reset();
        targetAppearance = previousAppearance;
      }
      const same = target && pose && close(target, pose, .42 + Math.min(age, HOLD_MS) / 700)
        && compatibleAppearance(targetAppearance, appearance);
      const differentGolfer = pose && !target &&
        !compatibleAppearance(targetAppearance, appearance || candidate?.appearance);
      const eligible = pose && (target ? same : insideTee(pose) &&
        (!differentGolfer || (pose.stance && pose.angle)));
      let observed = false;
      if (same && age <= HOLD_MS) {
        target = pose;
        trackedAt = now;
        observed = true;
      } else if (eligible) {
        if (!candidate || now - candidate.last > HOLD_MS || !close(candidate.origin, pose, .56)
            || !compatibleAppearance(candidate.appearance, appearance)
            || (differentGolfer && (pose.angle !== candidate.origin.angle || !candidate.origin.stance ||
                distance(candidate.origin.grip, pose.grip) > pose.torso * .25))) {
          candidate = {origin:pose, appearance, since:now, last:now, count:0};
        }
        if (!candidate.appearance) candidate.appearance = appearance;
        candidate.last = now;
        candidate.count++;
        if (now - candidate.since >= (differentGolfer ? ADDRESS_MS : ACQUIRE_MS) && candidate.count >= 3) {
          target = pose;
          targetAppearance = candidate.appearance || targetAppearance;
          silhouette = null;
          trackedAt = now;
          observed = true;
        }
      } else if (pose || (candidate && now - candidate.last > HOLD_MS)) {
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
    let anchor = null, start = null, previous = null, stationary = null, checkpoint = null;
    function update(pose, ready, now, held = false) {
      if (!pose?.grip) {
        start = stationary = null;
        if (!held && (!pose || previous === null || now - previous > HOLD_MS)) {
          anchor = previous = checkpoint = null;
        }
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
        const luma = at(x, y);
        if (luma < 88) continue;
        const exposure = clamp(luma / 165, .50, 1);
        const white = Math.min(red,green,blue) >= 156 * exposure && spread <= 55 * exposure;
        const yellow = red >= 158 * exposure && green >= 148 * exposure
          && red - blue >= 42 * exposure && green - blue >= 42 * exposure && red >= green * .86;
        if (!white && !yellow) continue;
        const near = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
        const inner = Math.max(2, Math.floor(radius*.6));
        const diagonal = Math.max(1,Math.round(inner*.707));
        const innerRing = [at(x-inner,y),at(x+inner,y),at(x,y-inner),at(x,y+inner),
          at(x-diagonal,y-diagonal),at(x+diagonal,y-diagonal),
          at(x-diagonal,y+diagonal),at(x+diagonal,y+diagonal)];
        if (innerRing.filter(v => v >= luma - 55 * exposure).length < (yellow ? 4 : 6)) continue;
        const ring = Math.ceil(radius * 1.36);
        const far = [at(x - ring, y), at(x + ring, y), at(x, y - ring), at(x, y + ring),
          at(x - radius, y - radius), at(x + radius, y - radius),
          at(x - radius, y + radius), at(x + radius, y + radius)];
        const brightCore = (luma * 2 + near.reduce((a, b) => a + b, 0)) / 6;
        if (far.filter(v => brightCore - v >= 20 * exposure).length < 6) continue;
        const score = brightCore - far.reduce((a, b) => a + b, 0) / far.length;
        ballCandidates.push({x, y, exposure, score:score + .25*luma});
      }
    }
    ballCandidates.sort((a, b) => b.score - a.score);
    const distinct = [];
    for (const ball of ballCandidates) {
      if (distinct.every(other => distance(ball,other) > radius+1)) distinct.push(ball);
      if (distinct.length >= 20) break;
    }
    function shaftSupport(top, end, exposure) {
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
        const polarity = Math.max(hi,lo) < Math.max(7, 11 * exposure) ? 0 : hi >= lo ? 1 : -1;
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
            const support = shaftSupport(top,end,ball.exposure);
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

  // Independent geometric reference, not the SwingProfile model or its weights.
  // The existing detector requires a brightly isolated ball plus a shaft.
  // This fallback looks for a *real image edge* matching a club shaft from
  // the measured grip toward the ground. The endpoint is only an estimate;
  // never present it as a ball that was detected.
  function findShaftZone(pixels, width, height, pose) {
    if (!pose?.grip || !pose?.feet || !pose?.shoulder || !pixels ||
        pixels.length !== width * height * 4 || width < 64 || height < 64) return null;
    const xy = p => ({x:p.x / pose.aspect * width,y:p.y * height});
    const grip = xy(pose.grip), feet = xy(pose.feet), neck = xy(pose.shoulder), hip = xy(pose.hip);
    const torso = pose.torso * height;
    if (torso < 19 || feet.y - grip.y < torso*.65) return null;
    const dxHand = grip.x - hip.x;
    const sides = Math.abs(dxHand) > torso*.09 ? [Math.sign(dxHand)] : [-1,1];
    const luma = (x,y) => {
      const xx=Math.round(x), yy=Math.round(y);
      if (xx < 1 || xx >= width-1 || yy < 1 || yy >= height-1) return NaN;
      const i = (yy*width+xx)*4;
      return (77*pixels[i]+150*pixels[i+1]+29*pixels[i+2])/256;
    };
    function edgeSupport(top,end) {
      const dx=end.x-top.x,dy=end.y-top.y,len=Math.hypot(dx,dy);
      if (len<.73*torso || dy<.53*len || Math.abs(dx)<.23*torso) return null;
      const nx=dy/len, ny=-dx/len, offset=clamp(torso*.052,2.2,4.5);
      let dark=0, light=0, length=0, longest=0, previous=0, contrast=0;
      for (let i=0;i<20;i++) {
        const t=.12 + .77*i/19;
        const x=top.x+t*dx,y=top.y+t*dy;
        const center=luma(x,y);
        const left=luma(x+nx*offset,y+ny*offset);
        const right=luma(x-nx*offset,y-ny*offset);
        if (![center,left,right].every(Number.isFinite)) return null;
        const delta=(left+right)/2-center;
        const tone=Math.abs(delta)>=12 ? (delta>0 ? 1 : -1) : 0;
        if (tone===1)dark++;
        if (tone===-1)light++;
        length=tone&&tone===previous?length+1:tone?1:0;
        longest=Math.max(longest,length);
        previous=tone;
        if (tone)contrast+=Math.min(75,Math.abs(delta));
      }
      const consistent=Math.max(dark,light);
      if (consistent<14 || longest<7 || contrast/consistent<15) return null;
      return {score:consistent*7+contrast/5+longest*3,consistent};
    }
    const candidates=[];
    for (const sign of sides) {
      for (let step=.40; step<=1.55; step+=.095) {
        const endX=grip.x+sign*step*torso;
        for (let yStep=-.22;yStep<=.24;yStep+=.07) {
          const end={x:endX,y:feet.y+yStep*torso};
          if (end.x<7||end.x>=width-7||end.y<7||end.y>=height-7)continue;
          for (const shift of [-.045,0,.045]) {
            const top={x:grip.x+shift*torso,y:grip.y};
            const edge=edgeSupport(top,end);
            if (!edge)continue;
            // Prefer a shaft anchored near the hands and terminating at turf.
            const score=edge.score-20*Math.abs(yStep)-10*Math.abs(shift);
            candidates.push({top,end,score,sign});
          }
        }
      }
    }
    candidates.sort((a,b)=>b.score-a.score);
    const best=candidates[0];
    if(!best)return null;
    // A similarly convincing edge on the opposite side is ambiguous; wait.
    if (sides.length>1 && candidates.some(c=>c.sign!==best.sign && c.score>best.score*.93))return null;
    const norm=p=>({x:p.x/width,y:p.y/height});
    return {ball:norm(best.end),grip:norm(best.top),neck:norm(neck),source:'shaft',confidence:'shaft-only'};
  }

  // SwingProfile documents a distinct *golfer fitting helper*: it should not
  // be confused with the green swing-plane/V zone shown on analysis video.
  // This guide is advisory only; it does not bypass or change READY.
  function fittingStatus(box) {
    if (!box) return {good:false,label:'골퍼 확인 중'};
    const height=box.bottom-box.top;
    if (height<.42) return {good:false,label:'골퍼가 작게 보입니다'};
    if (height>.93 || box.top<.01 || box.bottom>.99)
      return {good:false,label:'전신이 화면 안에 들도록 조정'};
    return {good:true,label:'골퍼 크기 양호'};
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

  // PC R15 verified side classifier copied verbatim into the mobile-only bridge.
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function svPcConfirmedSideAddress(){
  const p=window.svPcPipeline;
  // A stable side orientation is valid before the tracker has locked a full side stance.
  // Front-on and untracked subjects still cannot use the side-only gate.
  return !!(p && p.accepted === true &&
    (p.angle === 'side' || (p.stableSide === true && p.angle !== 'front')) &&
    p.poseAngle !== 'front');
}
function svPcSideReadyAnkle(lm){
  // A measured, same-side knee+ankle is sufficient in profile view.
  // Never mix a hidden ankle into the READY anchor or synthesize a joint.
  const reliable=i=>{
    const p=lm?.[i];
    return !!(p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
      (p.visibility == null || p.visibility >= .20));
  };
  const ankles=[];
  if(reliable(25) && reliable(27)) ankles.push(lm[27]);
  if(reliable(26) && reliable(28)) ankles.push(lm[28]);
  if(!ankles.length)return null;
  return {x:ankles.reduce((v,p)=>v+p.x,0)/ankles.length,
          y:ankles.reduce((v,p)=>v+p.y,0)/ankles.length};
}
function svPcSideAddressSimilarity(lm){
  const mode='side';
  const good=i=>{
    const p=lm?.[i];
    return !!(p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
      (p.visibility == null || p.visibility >= .20));
  };
  const empty={ok:false,score:0,mode,checks:null,obviousOneLeg:false};
  // Side-on legs and wrists occlude each other. Require true observations:
  // both shoulders, both hips, one wrist, and a matched knee/ankle leg.
  if(![11,12,23,24].every(good) || (![15,16].some(good)) ||
     !((good(25)&&good(27))||(good(26)&&good(28))))return empty;
  const median=(ids)=>{
    const valid=ids.filter(good);
    return {x:valid.reduce((a,i)=>a+lm[i].x,0)/valid.length,
            y:valid.reduce((a,i)=>a+lm[i].y,0)/valid.length};
  };
  const sh=median([11,12]), hp=median([23,24]);
  const hand=median([15,16]);
  const torsoLen=Math.max(.001,dist(sh,hp));
  // Only waive the *minimum horizontal separation*, which is a front-view
  // requirement. Preserve maximums to reject inconsistent geometry.
  const footGap=good(27)&&good(28)?Math.abs(lm[27].x-lm[28].x):NaN;
  const kneeGap=good(25)&&good(26)?Math.abs(lm[25].x-lm[26].x):NaN;
  const handGap=good(15)&&good(16)?dist(lm[15],lm[16]):NaN;
  const handBelow=(hand.y-sh.y)/torsoLen;
  const handFromHips=Math.abs(hand.y-hp.y)/torsoLen;
  // R12: SIDE ONLY. The average of two occluding legs is not a measured
  // anatomical chain. Check the knee and ankle from the SAME observed leg.
  // Keep each original 0.13 segment minimum. Never synthesize unseen joints.
  const legChains = [[25,27,'left'],[26,28,'right']]
    .filter(([k,a])=>good(k)&&good(a))
    .map(([k,a,side])=>({side,
      // The complete observed anatomical chain must use its own hip.
      hipToKnee:dist(lm[side==='left'?23:24],lm[k]),
      kneeToAnkle:dist(lm[k],lm[a])}));
  const legEvidence = Math.max(0,...legChains.map(l=>Math.min(l.hipToKnee,l.kneeToAnkle)));
  const legOk = legChains.some(l=>l.hipToKnee>=.13 && l.kneeToAnkle>=.13);
  const bodyCentered=hp.x>.18 && hp.x<.82;
  const footOk=!Number.isFinite(footGap)||footGap<=.38;
  const kneeOk=!Number.isFinite(kneeGap)||kneeGap<=.34;
  const handsOk=!Number.isFinite(handGap)||handGap<=.24;
  // Do not invent symmetry using missing landmarks. If both legs are visible,
  // retain the original explicit one-leg rejection rules.
  const hipDiff=Math.abs(lm[23].y-lm[24].y);
  const bothKnees=good(25)&&good(26), bothAnkles=good(27)&&good(28);
  const kneeDiff=bothKnees?Math.abs(lm[25].y-lm[26].y):0;
  const ankleDiff=bothAnkles?Math.abs(lm[27].y-lm[28].y):0;
  const obviousOneLeg=(bothKnees && hipDiff>.085 && kneeDiff>.095) ||
    (bothKnees && kneeDiff>.13) ||
    (bothAnkles && ankleDiff>.12 && hipDiff>.065);
  const checks=[
    ['골반 중앙',bodyCentered,hp.x,'0.18~0.82'],
    ['측면 발 겹침',footOk,footGap,'≤0.38 (최소 간격 제외)'],
    ['측면 무릎 겹침',kneeOk,kneeGap,'≤0.34 (최소 간격 제외)'],
    ['양손/한손 가림',handsOk,handGap,'≤0.24 또는 측면 가림'],
    ['손 높이',handBelow>=.45 && handBelow<=2.50,handBelow,'0.45~2.50'],
    ['손-골반',handFromHips<=1.55,handFromHips,'≤1.55'],
    ['다리 길이',legOk,legEvidence,'각 구간 ≥0.13 (같은 쪽 다리)']
  ];
  const score=checks.filter(c=>c[1]).length;
  // R13 SIDE ONLY: a fixed, normalized-screen 0.13 leg length is NOT
  // distance invariant; the R12 field log failed the knee/ankle gate in
  // 78.3% of measured side frames at the user's actual camera position.
  // Keep original 0.13 measurement and the 5-of-7 score as diagnostics,
  // but do not use pixel scale as an obligatory side-address veto.
  // Both hands/hip geometry AND a measured same-side knee/ankle chain
  // are still required; no missing landmark is synthesized.
  // 850ms dwell, motion, tracking, and front-view classifier untouched.
  const measuredLeg=legChains.length>0;
  return {ok:score>=5 && bodyCentered && handsOk && checks[4][1] && checks[5][1] &&
    measuredLeg && !obviousOneLeg,score,obviousOneLeg,checks,mode,legChains};
}

  if(typeof module!=='undefined' && module.exports){
    module.exports={observe,torsoRegion,appearanceFromPixels,createTracker,findVZone,createZoneLock,createMotionGate};
    return;
  }

  // This bridge adapts the exact PC R15 pose tracker/motion gate to the
  // currently deployed SV-MOBILE frame and lifecycle. It does NOT replace
  // camera, recording, replay storage, WMC bridge or UI layout.
  const svMobileTracking=createTracker();
  const svMobileGate=createMotionGate();
  const svMobileTemporal=root.svPcR15CreateSideTemporalGate?.();
  const shirt=document.createElement('canvas');shirt.width=40;shirt.height=30;
  const shirtCtx=shirt.getContext('2d',{willReadFrequently:true});
  let latest=null,currentPose=null,confirmedMotion=false;
  let sideSince=null,sideSamples=0,stableSide=false,lastOrientation=null;
  let temporalEnabled=true;
  let frames=0,acceptedFrames=0;

  function reset(){
    svMobileTracking.reset();svMobileGate.update(null,false,0);svMobileTemporal?.reset();
    latest=currentPose=null;confirmedMotion=false;sideSince=null;sideSamples=0;stableSide=false;
    root.svPcPipeline={phase:'searching',accepted:false,poseSeen:false,angle:null,poseAngle:null,stableSide:false};
    root.svPcTrackerAccepted=false;
  }
  function observeFrame(lm,now,image,width,height,ready,armed,cooldown,swingStarted){
    if(!image||!width||!height||!Number.isFinite(now)){
      reset();return null;
    }
    if(lastOrientation!==width+'x'+height){reset();lastOrientation=width+'x'+height;}
    currentPose=observe(lm,width/height,true);
    let appearance=null;
    const region=currentPose && torsoRegion(currentPose,width,height);
    if(region&&shirtCtx){
      try{shirtCtx.drawImage(image,region.x,region.y,region.w,region.h,0,0,shirt.width,shirt.height);
        appearance=appearanceFromPixels(shirtCtx.getImageData(0,0,shirt.width,shirt.height).data);
      }catch(_){/* Camera geometry remains usable if pixel sampling fails. */}
    }
    latest=svMobileTracking.update(currentPose,now,appearance);
    if(latest.accepted&&currentPose?.angle==='side'){
      if(sideSince===null)sideSince=now;
      sideSamples++;
    }else if(latest.phase!=='held'){sideSince=null;sideSamples=0;}
    stableSide=sideSince!==null && sideSamples>=3 && now-sideSince>=ADDRESS_MS;
    confirmedMotion=svMobileGate.update(latest.accepted&&armed&&!cooldown?currentPose:null,
      !!ready,now,armed&&!cooldown&&latest.phase==='held');
    if(!latest.accepted)svMobileTemporal?.reset();
    root.svPcTrackerAccepted=!armed||!!cooldown||!!swingStarted||!!latest.accepted;
    frames++;if(latest.accepted)acceptedFrames++;
    root.svPcPipeline={frames,trustedFrames:acceptedFrames,phase:latest.phase,
      accepted:!!latest.accepted,poseSeen:!!currentPose,angle:latest.angle,poseAngle:currentPose?.angle??null,
      stableSide,reason:latest.phase==='tracked'?'골퍼 추적 중':'골퍼 추적 확인 중'};
    return root.svPcPipeline;
  }
  function filteredMotion(m){
    // Preserve raw values for diagnostics; PC R15 movement confirmation gates the
    // hand speed used in the legacy SWING condition, without guessing landmarks.
    if(!confirmedMotion) return {...m,handSpeed:0,originalHandSpeed:m.handSpeed,motionConfirmed:false};
    return {...m,originalHandSpeed:m.handSpeed,motionConfirmed:true};
  }
  function sideActive(){return svPcConfirmedSideAddress();}
  function reliableAnkle(lm){return svPcSideReadyAnkle(lm);}
  function temporalCandidate(now,m,addressCheck,feetPlanted,ready,locked,cooldown,swingStarted){
    if(!temporalEnabled||!svMobileTemporal||!sideActive()||addressCheck?.mode!=='side'
       ||!root.svPcTrackerAccepted||root.svPcPipeline?.angle!=='side'){
      svMobileTemporal?.reset();return false;
    }
    return svMobileTemporal.update(now,{eligible:!!ready&&!!locked&&!cooldown&&!swingStarted,
      hand:m.handSpeed>=.16,turn:m.shoulderTurn>=.015,feet:!!feetPlanted});
  }
  function ensureUI(){
    if(document.getElementById('svMobileR15MotionControl'))return;
    const control=document.createElement('label');control.id='svMobileR15MotionControl';
    control.style.cssText='position:fixed;left:8px;top:calc(env(safe-area-inset-top,0px) + 145px);z-index:5200;display:inline-flex;align-items:center;gap:6px;padding:6px 9px;background:rgba(7,28,21,.91);color:#c4ffcf;border:1px solid #5cae82;border-radius:8px;font:700 12px Arial,sans-serif';
    control.title='PC R15 측면 50ms 감지 · 해제 시 기존 감지 방식';
    const input=document.createElement('input');input.id='svMobileR15MotionCheck';input.type='checkbox';input.checked=true;
    input.style.cssText='width:17px;height:17px;accent-color:#55df83;margin:0';
    const label=document.createElement('span');label.textContent='R15 측면 감지';
    input.addEventListener('change',()=>{temporalEnabled=input.checked;svMobileTemporal?.reset();});
    control.append(input,label);document.body.appendChild(control);
    const stage=document.getElementById('liveStage');
    if(!stage)return;
    // Presentation only; no changes to READY or pose geometry.
    const c=document.createElement('div');c.id='svMobileR15Status';
    c.style.cssText='position:absolute;left:8px;top:7px;pointer-events:none;z-index:10;background:#071a16c9;color:#bbc4c4;font:700 12px Arial,sans-serif;padding:3px 7px;border-radius:6px';
    stage.appendChild(c);
    setInterval(()=>{const p=root.svPcPipeline||{};const angle=p.accepted?(p.angle||(p.stableSide?'side':null)):null;
      const color=angle==='front'?'#28caff':angle==='side'?'#e9bf70':'#929b98';
      c.textContent=angle==='front'?'FRONT':angle==='side'?'SIDE':p.phase==='held'?'골퍼 재확인':'방향 확인';
      c.style.color=color;stage.style.outline='2px '+(angle?'solid':'dashed')+' '+color;
    },300);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureUI,{once:true});else ensureUI();
  root.svPcReplayZoneAPI=Object.freeze({observe,findVZone,findShaftZone,createZoneLock});
  root.svMobileR15=Object.freeze({observeFrame,sideActive,sideAddress:svPcSideAddressSimilarity,
    reliableAnkle,filteredMotion,temporalCandidate,reset,getPipeline:()=>root.svPcPipeline,
    liveObservation:()=>({tracking:latest,pose:latest?.accepted?currentPose:null}),
    setMotionEnabled:v=>{temporalEnabled=!!v;svMobileTemporal?.reset();}});
})(typeof window==='undefined'?globalThis:window);
