import base64
import hashlib
import json
from datetime import datetime, timezone
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from server import app as m

UID='user-a'
TOKEN='google-purchase-token'

def payload(state='ACTIVE', expiry=4102444800, uid=UID):
    return {'subscriptionState':'SUBSCRIPTION_STATE_'+state,
            'externalAccountIdentifiers':{'obfuscatedExternalAccountId':hashlib.sha256(uid.encode()).hexdigest()},
            'acknowledgementState':'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
            'lineItems':[{'productId':m.PRODUCT,'expiryTime':datetime.fromtimestamp(expiry,timezone.utc).isoformat(),'latestSuccessfulOrderId':'GPA.123'}]}

@pytest.fixture
def ctx(tmp_path,monkeypatch):
    monkeypatch.setattr(m,'ROOT',tmp_path)
    monkeypatch.setattr(m,'PROJECT','test-project')
    state={'payload':payload()}
    monkeypatch.setattr(m,'subscription',lambda token:state['payload'])
    m.app.dependency_overrides[m.user]=lambda:UID
    with TestClient(m.app) as c:
        yield c,state
    m.app.dependency_overrides.clear()

@pytest.mark.parametrize('state,expiry,allowed',[
    ('ACTIVE',2000,True),('CANCELED',2000,True),('IN_GRACE_PERIOD',2000,True),
    ('ON_HOLD',2000,False),('PAUSED',2000,False),('PENDING',2000,False),
    ('EXPIRED',2000,False),('PENDING_PURCHASE_CANCELED',2000,False),('ACTIVE',999,False)])
def test_subscription_states(state,expiry,allowed):
    assert m.evaluate(payload(state,expiry),UID,now=1000)[0] is allowed

def test_token_cannot_move_accounts():
    with pytest.raises(HTTPException) as e:m.evaluate(payload(uid='other-user'),UID)
    assert e.value.status_code==403

def test_no_purchase_no_premium(ctx):
    c,_=ctx
    assert c.get('/v1/entitlement').json()['pro'] is False
    assert c.get('/v1/videos').status_code==403
    assert c.post('/v1/videos',content=b'fake',headers={'Content-Type':'video/webm'}).status_code==403

def test_restore_and_revoke(ctx):
    c,state=ctx
    assert c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN}).json()['pro']
    assert c.get('/v1/videos').status_code==200
    state['payload']=payload('EXPIRED')
    assert not c.get('/v1/entitlement').json()['pro']
    assert c.get('/v1/videos').status_code==403

def test_no_cached_access_on_google_failure(ctx,monkeypatch):
    c,_=ctx;c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN})
    def fail(_):raise HTTPException(503,'unavailable')
    monkeypatch.setattr(m,'subscription',fail)
    assert c.get('/v1/videos').status_code==503

def test_upload_download_and_cross_user_isolation(ctx):
    c,_=ctx;c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN})
    video=b'\x1aE\xdf\xa3'+b'\x00'*20
    r=c.post('/v1/videos',content=video,headers={'Content-Type':'video/webm'})
    assert r.status_code==201
    video_id=r.json()['id']
    assert c.get('/v1/videos/'+video_id).content==video
    m.app.dependency_overrides[m.user]=lambda:'other-user'
    # Even a second entitled user cannot fetch the first user's file.
    m.app.dependency_overrides[m.pro_user]=lambda:'other-user'
    assert c.get('/v1/videos/'+video_id).status_code==404
    assert c.delete('/v1/videos/'+video_id).status_code==404

def test_invalid_container(ctx):
    c,_=ctx;c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN})
    assert c.post('/v1/videos',content=b'<html>not video</html>',headers={'Content-Type':'video/webm'}).status_code==415

def test_owner_delete_after_expiry(ctx):
    c,state=ctx;c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN})
    r=c.post('/v1/videos',content=b'\x1aE\xdf\xa3xxxx',headers={'Content-Type':'video/webm'})
    state['payload']=payload('EXPIRED')
    assert c.delete('/v1/videos/'+r.json()['id']).status_code==204

def test_quota(ctx,monkeypatch):
    c,_=ctx;c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN});monkeypatch.setattr(m,'QUOTA',4)
    assert c.post('/v1/videos',content=b'\x1aE\xdf\xa3xxxx',headers={'Content-Type':'video/webm'}).status_code==413
    assert not list((m.ROOT/'videos').iterdir())

def test_admin_denied(ctx):
    c,_=ctx;assert c.get('/v1/admin/orders').status_code==403

def test_auth_required(ctx):
    c,_=ctx;m.app.dependency_overrides.clear()
    assert c.get('/v1/entitlement').status_code==401

def test_forged_push_rejected(ctx,monkeypatch):
    c,_=ctx;monkeypatch.setattr(m,'PUBSUB_AUDIENCE','https://vault/rtdn');monkeypatch.setattr(m,'PUBSUB_EMAIL','push@example.com')
    assert c.post('/v1/play/rtdn',json={}).status_code==401

def test_rtdn_out_of_order_rechecks_google(ctx,monkeypatch):
    c,state=ctx;c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN})
    monkeypatch.setattr(m,'PUBSUB_AUDIENCE','https://vault/rtdn');monkeypatch.setattr(m,'PUBSUB_EMAIL','push@example.com')
    monkeypatch.setattr(m.id_token,'verify_oauth2_token',lambda *a,**k:{'email':'push@example.com','email_verified':True})
    state['payload']=payload('EXPIRED')
    # A late RENEWED message must not resurrect a revoked purchase.
    message={'packageName':m.PACKAGE,'subscriptionNotification':{'purchaseToken':TOKEN,'notificationType':2}}
    envelope={'message':{'messageId':'1','data':base64.b64encode(json.dumps(message).encode()).decode()}}
    assert c.post('/v1/play/rtdn',json=envelope,headers={'Authorization':'Bearer good'}).status_code==200
    assert c.post('/v1/play/rtdn',json=envelope,headers={'Authorization':'Bearer good'}).status_code==200
    assert c.get('/v1/videos').status_code==403

def test_acknowledgement_is_server_side_and_retryable(ctx,monkeypatch):
    c,state=ctx;state['payload']['acknowledgementState']='ACKNOWLEDGEMENT_STATE_PENDING'
    calls=[]
    class Reply:
        def raise_for_status(self):pass
    class Session:
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,url,**kwargs):calls.append(url);return Reply()
    monkeypatch.setattr(m,'google_session',Session)
    assert c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN}).json()['pro']
    assert len(calls)==1 and calls[0].endswith(':acknowledge')

def test_deleted_purchase_denies_access(ctx):
    c,state=ctx;c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN})
    state['payload']=None
    assert c.get('/v1/videos').status_code==403

def test_token_replay_from_other_firebase_account(ctx):
    c,_=ctx;c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN})
    m.app.dependency_overrides[m.user]=lambda:'other'
    assert c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN}).status_code==403

def test_renewal_keeps_order_history(ctx):
    c,state=ctx;c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN})
    state['payload']['lineItems'][0]['latestSuccessfulOrderId']='GPA.123..1'
    c.get('/v1/entitlement')
    with m.db() as d:
        assert d.execute('SELECT COUNT(*) FROM orders').fetchone()[0]==2
