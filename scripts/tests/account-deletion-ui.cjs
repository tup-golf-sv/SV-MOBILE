const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../../server/account-deletion.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
async function scenario(responses, confirmed=true) {
  let submit;
  const nodes = Object.fromEntries(['request','email','password','confirm','submit','status'].map(id=>[id,{value:'',checked:confirmed,disabled:false,textContent:''}]));
  nodes.email.value='test@example.invalid';nodes.password.value='test-only-password';
  nodes.request.addEventListener=(_,fn)=>{submit=fn;};nodes.request.reset=()=>{};
  const requests=[];
  vm.runInNewContext(source,{document:{getElementById:id=>nodes[id]},fetch:async(url,options)=>{
    requests.push({url,options});const next=responses.shift();assert.ok(next,'unexpected request');
    return {ok:next.ok,json:async()=>next.body};
  }});
  await submit({preventDefault(){}});
  return {nodes,requests};
}
(async()=>{
  let r=await scenario([],false);assert.equal(r.requests.length,0);
  r=await scenario([{ok:true,body:{apiKey:''}}]);assert.equal(r.requests.length,1);assert.match(r.nodes.status.textContent,/접수하지 않았/);
  const config={ok:true,body:{apiKey:'test-key'}};
  r=await scenario([config,{ok:false,body:{}}]);assert.equal(r.requests.length,2);assert.equal(r.nodes.password.value,'');assert.match(r.nodes.status.textContent,/접수되지 않았/);
  const login={ok:true,body:{idToken:'test-token'}};
  r=await scenario([config,login,{ok:true,body:{requestId:'receipt-1',status:'RECEIVED',deletionCompleted:false}}]);
  assert.match(r.nodes.status.textContent,/receipt-1/);assert.match(r.nodes.status.textContent,/완료됐다는 뜻은 아닙니다/);
  assert.deepEqual(JSON.parse(r.requests[2].options.body),{confirm:true});
  assert.equal(r.nodes.password.value,'');assert.equal(r.nodes.submit.disabled,false);
  for(const body of [{}, {requestId:'x',status:'COMPLETED',deletionCompleted:true}]){
    r=await scenario([config,login,{ok:true,body}]);assert.doesNotMatch(r.nodes.status.textContent,/삭제 요청이 접수되었습니다/);
  }
  r=await scenario([config,login,{ok:false,body:{}}]);assert.doesNotMatch(r.nodes.status.textContent,/삭제 요청이 접수되었습니다/);
  console.log('PASS: 7 deletion-request UI scenarios; no external requests');
})().catch(error=>{console.error(error);process.exitCode=1;});
