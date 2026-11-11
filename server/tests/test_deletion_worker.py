import time
import base64
import json
from pathlib import Path
import pytest
from fastapi import HTTPException
from server import app as m
from server.deletion_worker import process_request, FirebaseAccountDeleter
from server.tests.test_app import ctx, UID, TOKEN


def request(c):
    return c.post('/v1/account-deletion-requests',json={'confirm':True}).json()['requestId']


class FakeDeleter:
    def __init__(self,fail=False):self.calls=[];self.fail=fail
    def delete(self,uid):
        self.calls.append(uid)
        if self.fail:raise RuntimeError('external failure')


def test_worker_disabled_does_not_call_external(ctx):
    c,_=ctx;rid=request(c);external=FakeDeleter()
    with pytest.raises(RuntimeError):process_request(rid,external)
    assert external.calls==[]
    with m.db() as d:assert d.execute('SELECT COUNT(*) FROM account_deletion_jobs').fetchone()[0]==0


def test_worker_deletes_only_request_owner_and_is_idempotent(ctx):
    c,_=ctx;c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN})
    own=c.post('/v1/videos',content=b'\x1aE\xdf\xa3xxxx',headers={'Content-Type':'video/webm'}).json()['id']
    other='a'*32;(m.ROOT/'videos'/other).write_bytes(b'other-video')
    with m.db() as d:
        d.execute('INSERT INTO videos VALUES (?,?,?,?,?)',(other,'other','video/webm',11,'now'))
        d.execute('INSERT INTO purchases VALUES (?,?,?,?,?,?)',('other-token','other','ACTIVE',0,'other-order',0))
        d.execute('INSERT INTO orders VALUES (?,?,?)',('other-order','other','other-token'))
    rid=request(c);external=FakeDeleter()
    assert process_request(rid,external,enabled=True)=={'status':'COMPLETED','deletionCompleted':True}
    assert process_request(rid,external,enabled=True)['deletionCompleted'] is True
    assert external.calls==[UID]
    assert not (m.ROOT/'videos'/own).exists()
    assert (m.ROOT/'videos'/other).read_bytes()==b'other-video'
    with m.db() as d:
        for table in ['videos','purchases','orders']:
            assert d.execute(f'SELECT COUNT(*) FROM {table} WHERE uid=?',(UID,)).fetchone()[0]==0
            assert d.execute(f'SELECT COUNT(*) FROM {table} WHERE uid=?',('other',)).fetchone()[0]==1
    with pytest.raises(HTTPException):m.ensure_account_open(UID)
    m.ensure_account_open('other')


def test_external_failure_preserves_data_and_retry_completes(ctx):
    c,_=ctx;c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN})
    video=c.post('/v1/videos',content=b'\x1aE\xdf\xa3xxxx',headers={'Content-Type':'video/webm'}).json()['id']
    rid=request(c);external=FakeDeleter(True)
    assert process_request(rid,external,enabled=True)=={'status':'FAILED','deletionCompleted':False}
    assert (m.ROOT/'videos'/video).exists()
    with m.db() as d:assert d.execute('SELECT COUNT(*) FROM purchases WHERE uid=?',(UID,)).fetchone()[0]==1
    external.fail=False
    assert process_request(rid,external,enabled=True)['deletionCompleted'] is True
    assert external.calls==[UID,UID]


def test_live_claim_is_not_processed_twice_and_stale_claim_recovers(ctx):
    c,_=ctx;rid=request(c);external=FakeDeleter()
    with m.db() as d:d.execute('INSERT INTO account_deletion_jobs VALUES (?,?,?,?,?)',(rid,'PROCESSING','old',time.time(),''))
    assert process_request(rid,external,enabled=True)['status']=='PROCESSING'
    assert external.calls==[]
    with m.db() as d:d.execute('UPDATE account_deletion_jobs SET updated=0')
    assert process_request(rid,external,enabled=True)['status']=='COMPLETED'
    assert external.calls==[UID]


def test_unknown_request_does_not_call_firebase(ctx):
    external=FakeDeleter()
    with pytest.raises(ValueError):process_request('missing',external,enabled=True)
    assert external.calls==[]


def test_unsafe_video_path_cannot_remove_unrelated_file(ctx):
    c,_=ctx;rid=request(c);outside=m.ROOT/'keep';outside.write_text('safe')
    with m.db() as d:d.execute('INSERT INTO videos VALUES (?,?,?,?,?)',('../keep',UID,'video/webm',4,'now'))
    assert process_request(rid,FakeDeleter(),enabled=True)['status']=='FAILED'
    assert outside.read_text()=='safe'


def test_inflight_receipt_verification_cannot_recreate_deleted_data(ctx):
    c,_=ctx;rid=request(c)
    process_request(rid,FakeDeleter(),enabled=True)
    assert c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN}).status_code==403
    with m.db() as d:assert d.execute('SELECT COUNT(*) FROM purchases WHERE uid=?',(UID,)).fetchone()[0]==0


def test_admin_view_reports_failed_then_completed_worker_state(ctx,monkeypatch):
    c,_=ctx;rid=request(c);external=FakeDeleter(True)
    process_request(rid,external,enabled=True)
    monkeypatch.setattr(m,'ADMIN_UIDS',{'operator'})
    m.app.dependency_overrides[m.user]=lambda:'operator'
    assert c.get('/v1/admin/account-deletion-requests').json()['requests'][0]['status']=='FAILED'
    external.fail=False;process_request(rid,external,enabled=True)
    assert c.get('/v1/admin/account-deletion-requests').json()['requests'][0]['status']=='COMPLETED'


@pytest.mark.parametrize('state',['PROCESSING','FAILED'])
def test_rtdn_acks_deleting_account_without_refresh_or_new_grant(ctx,monkeypatch,state):
    c,_=ctx;c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN})
    rid=request(c)
    with m.db() as d:
        before=tuple(d.execute('SELECT * FROM purchases WHERE token=?',(TOKEN,)).fetchone())
        d.execute('INSERT INTO account_deletion_jobs VALUES (?,?,?,?,?)',(rid,state,'worker',time.time(),''))
    monkeypatch.setattr(m,'PUBSUB_AUDIENCE','https://test/rtdn')
    monkeypatch.setattr(m,'PUBSUB_EMAIL','push@test.invalid')
    monkeypatch.setattr(m.id_token,'verify_oauth2_token',lambda *a,**k:{'email':'push@test.invalid','email_verified':True})
    def should_not_refresh(*a,**k):raise AssertionError('deleted account must not refresh')
    monkeypatch.setattr(m,'subscription',should_not_refresh)
    payload={'packageName':m.PACKAGE,'subscriptionNotification':{'purchaseToken':TOKEN,'notificationType':2}}
    envelope={'message':{'messageId':'delete-job-'+state,'data':base64.b64encode(json.dumps(payload).encode()).decode()}}
    for _ in range(2):
        assert c.post('/v1/play/rtdn',json=envelope,headers={'Authorization':'Bearer mocked-push'}).status_code==200
    with m.db() as d:
        assert tuple(d.execute('SELECT * FROM purchases WHERE token=?',(TOKEN,)).fetchone())==before
        assert d.execute('SELECT COUNT(*) FROM notifications WHERE message_id=?',('delete-job-'+state,)).fetchone()[0]==1
    with pytest.raises(HTTPException):m.ensure_account_open(UID)


def test_rtdn_acks_when_worker_claim_races_refresh(ctx,monkeypatch):
    c,_=ctx;c.post('/v1/purchases/verify',json={'purchaseToken':TOKEN});rid=request(c)
    monkeypatch.setattr(m,'PUBSUB_AUDIENCE','https://test/rtdn')
    monkeypatch.setattr(m,'PUBSUB_EMAIL','push@test.invalid')
    monkeypatch.setattr(m.id_token,'verify_oauth2_token',lambda *a,**k:{'email':'push@test.invalid','email_verified':True})
    def raced_refresh(*a,**k):
        with m.db() as d:d.execute('INSERT INTO account_deletion_jobs VALUES (?,?,?,?,?)',(rid,'PROCESSING','worker',time.time(),''))
        raise HTTPException(403,'account deletion in progress')
    monkeypatch.setattr(m,'refresh',raced_refresh)
    payload={'packageName':m.PACKAGE,'subscriptionNotification':{'purchaseToken':TOKEN,'notificationType':2}}
    envelope={'message':{'messageId':'raced-worker','data':base64.b64encode(json.dumps(payload).encode()).decode()}}
    assert c.post('/v1/play/rtdn',json=envelope,headers={'Authorization':'Bearer mocked-push'}).status_code==200
    with m.db() as d:assert d.execute('SELECT COUNT(*) FROM notifications WHERE message_id=?',('raced-worker',)).fetchone()[0]==1


@pytest.mark.parametrize('status,message,raises',[(200,'',False),(400,'USER_NOT_FOUND',False),(400,'INVALID_LOCAL_ID',True),(403,'PERMISSION_DENIED',True)])
def test_firebase_adapter_contract_is_mocked(monkeypatch,status,message,raises):
    calls=[]
    class Reply:
        status_code=status
        def json(self):return {'error':{'message':message}}
        def raise_for_status(self):
            if status>=400:raise RuntimeError('remote rejected')
    class Session:
        def __init__(self,credentials):pass
        def __enter__(self):return self
        def __exit__(self,*a):pass
        def post(self,url,**kwargs):calls.append((url,kwargs));return Reply()
    from server import deletion_worker as w
    monkeypatch.setattr(w.google.auth,'default',lambda **kwargs:('mock-credential',None))
    monkeypatch.setattr(w,'AuthorizedSession',Session)
    if raises:
        with pytest.raises(RuntimeError):FirebaseAccountDeleter('test-project').delete('test-user')
    else:FirebaseAccountDeleter('test-project').delete('test-user')
    assert calls[0][0]=='https://identitytoolkit.googleapis.com/v1/projects/test-project/accounts:delete'
    assert calls[0][1]['json']=={'localId':'test-user'}
