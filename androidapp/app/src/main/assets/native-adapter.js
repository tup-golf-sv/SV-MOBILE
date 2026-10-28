(()=>{
  if(window.__svNativeAdapter || !window.SVNative) return;
  window.__svNativeAdapter=true;
  const pending=new Map(); let serial=0,busy=false;
  SVNative.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.ok?p.resolve(m):p.reject(Error(m.error||'처리 실패'));}};
  function send(action,fields={}){return new Promise((resolve,reject)=>{const id=String(++serial);pending.set(id,{resolve,reject});SVNative.postMessage(JSON.stringify({id,action,...fields}));setTimeout(()=>{if(pending.delete(id))reject(Error('응답 시간이 초과되었습니다.'));},60000);});}
  const bar=document.getElementById('svMobileSaveBar');
  if(!bar)return;
  const old=document.getElementById('svMobileSaveBtn');
  const save=old.cloneNode(true);old.replaceWith(save);
  const cloud=document.createElement('button');cloud.textContent='Pro 클라우드 보관';cloud.type='button';bar.append(cloud);
  const status=document.getElementById('svMobileSaveStatus');
  const blob=()=>typeof latestReplayBlob!=='undefined'?latestReplayBlob:null;
  async function transfer(mode){
    const b=blob();if(!(b instanceof Blob)||!b.size)throw Error('먼저 스윙 영상을 촬영하세요.');
    const mime=b.type.includes('mp4')?'video/mp4':'video/webm';
    const session=crypto.randomUUID();await send('begin',{session,mode,mime,size:b.size});
    try{
      for(let offset=0;offset<b.size;offset+=196608){
        const bytes=new Uint8Array(await b.slice(offset,offset+196608).arrayBuffer());
        let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));
        await send('chunk',{session,data:btoa(text)});
      }
      const result=await send('finish',{session});
      status.textContent=mode==='cloud'?'Pro 클라우드 보관 완료':'휴대폰 Movies/SV MOBILE에 저장했습니다.';
      return result;
    }catch(e){send('abort',{session}).catch(()=>{});throw e;}
  }
  async function run(mode){if(busy)return;busy=true;save.disabled=cloud.disabled=true;try{status.textContent='영상을 저장하고 있습니다…';await transfer(mode);}catch(e){status.textContent=e.message;}finally{busy=false;save.disabled=cloud.disabled=false;}}
  save.addEventListener('click',()=>run('local'));cloud.addEventListener('click',()=>run('cloud'));
  setInterval(()=>{if(!busy)save.disabled=!blob();},1000);
})();
