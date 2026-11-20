/* SV-MOBILE PC R15: experimental side-only temporal co-occurrence gate.
 * TEST ONLY; enabled only by ?audit=1&motionTest=1. Original production gate remains unchanged.
 * 50ms observation horizon derived as a comparison window from R14 ~17ms captured frames.
 * Same 4 motion thresholds; requires >=2 separately observed planted-feet frames.
 * No landmarks or image data stored, only motion-test booleans/timestamps in RAM.
 */
(function(root){
  'use strict';
  function createSideTemporalGate(){
    const frames=[];
    let previousTime=null;
    const windowMs=50;
    function reset(){frames.length=0;previousTime=null;}
    function update(now,evidence){
      if (!Number.isFinite(now) || !evidence || evidence.eligible!==true){reset();return false;}
      if(previousTime!==null && (now<=previousTime || now-previousTime>windowMs))reset();
      previousTime=now;
      frames.push({t:now,hand:evidence.hand===true,turn:evidence.turn===true,feet:evidence.feet===true});
      while(frames.length && frames[0].t<now-windowMs)frames.shift();
      return frames.filter(v=>v.feet).length>=2 &&
        frames.some(v=>v.hand) && frames.some(v=>v.turn);
    }
    return {update,reset,windowMs};
  }
  root.svPcR15CreateSideTemporalGate=createSideTemporalGate;
  if(typeof module!=='undefined' && module.exports)module.exports={createSideTemporalGate};
})(typeof window!=='undefined'?window:globalThis);