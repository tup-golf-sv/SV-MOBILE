"""Private Pro video vault. Google is authoritative for every protected request.
No access based on client flags, receipt JSON, notification state, or cached expiry.
"""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import FastAPI, Depends, Header, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from google.auth.transport.requests import Request as GoogleRequest, AuthorizedSession
from google.oauth2 import id_token
import google.auth
from pydantic import BaseModel, Field, StrictBool, ConfigDict, field_validator

app = FastAPI(title="SV MOBILE Pro", docs_url=None, redoc_url=None)
ROOT = Path(os.environ.get("SV_DATA_DIR", "./data"))
PACKAGE = os.environ.get("SV_PACKAGE", "kr.co.tupgolf.svmobile")
PRODUCT = os.environ.get("SV_PRO_PRODUCT", "sv_mobile_pro")
PROJECT = os.environ.get("SV_FIREBASE_PROJECT", "")
PUBSUB_AUDIENCE = os.environ.get("SV_PUBSUB_AUDIENCE", "")
PUBSUB_EMAIL = os.environ.get("SV_PUBSUB_EMAIL", "")
ADMIN_UIDS = set(filter(None, os.environ.get("SV_ADMIN_UIDS", "").split(",")))
BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/"
MAX_VIDEO = 100 * 1024 * 1024
QUOTA = 1024 * 1024 * 1024  # 1 GiB per user; storage transaction serializes quota checks.


def db():
    ROOT.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(ROOT / "vault.sqlite", timeout=20)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.executescript("""
    CREATE TABLE IF NOT EXISTS purchases (
        token TEXT PRIMARY KEY, uid TEXT NOT NULL, state TEXT NOT NULL,
        expires REAL NOT NULL, order_id TEXT, updated REAL NOT NULL);
    CREATE INDEX IF NOT EXISTS purchase_users ON purchases(uid);
    CREATE TABLE IF NOT EXISTS orders (order_id TEXT PRIMARY KEY, uid TEXT NOT NULL, token TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS videos (
        id TEXT PRIMARY KEY, uid TEXT NOT NULL, mime TEXT NOT NULL,
        size INTEGER NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notifications (
        message_id TEXT PRIMARY KEY, received REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS account_deletion_requests (
        request_id TEXT PRIMARY KEY, uid TEXT NOT NULL UNIQUE,
        requested_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status='RECEIVED'));
    """)
    return c


def bearer(authorization):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "로그인이 필요합니다.")
    return authorization[7:]


def user(authorization: str | None = Header(default=None)):
    if not PROJECT:
        raise HTTPException(503, "계정 인증 서버가 설정되지 않았습니다.")
    try:
        claims = id_token.verify_firebase_token(bearer(authorization), GoogleRequest(), audience=PROJECT)
        if claims.get("iss") != f"https://securetoken.google.com/{PROJECT}" or not claims.get("sub"):
            raise ValueError("invalid identity")
        return claims["sub"]
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "로그인이 만료되었습니다.") from None


def google_session():
    try:
        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/androidpublisher"])
        return AuthorizedSession(credentials)
    except Exception:
        raise HTTPException(503, "Google Play 서버 인증이 연결되지 않았습니다.") from None


def play_get(path):
    try:
        with google_session() as session:
            r = session.get(BASE + quote(PACKAGE, safe="") + path, timeout=20)
            if r.status_code in (404, 410):
                return None
            r.raise_for_status()
            return r.json()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Google Play 상태를 확인할 수 없습니다.") from None


def subscription(token):
    return play_get("/purchases/subscriptionsv2/tokens/" + quote(token, safe=""))


def evaluate(payload, uid, now=None):
    """Canceled retains access until expiry; hold/pause/expired/pending deny access."""
    now = time.time() if now is None else now
    if not payload:
        return False, 0, "NOT_FOUND", ""
    expected = hashlib.sha256(uid.encode()).hexdigest()
    if payload.get("externalAccountIdentifiers", {}).get("obfuscatedExternalAccountId") != expected:
        raise HTTPException(403, "이 구매는 다른 Pro 계정에 연결되어 있습니다.")
    state = payload.get("subscriptionState", "UNKNOWN")
    lines = [line for line in payload.get("lineItems", []) if line.get("productId") == PRODUCT]
    expiry = 0
    order = ""
    for line in lines:
        try:
            when = datetime.fromisoformat(line["expiryTime"].replace("Z", "+00:00")).timestamp()
        except (KeyError, ValueError, TypeError):
            continue
        if when > expiry:
            expiry, order = when, line.get("latestSuccessfulOrderId", "")
    allowed = state in {"SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_CANCELED"} and expiry > now
    return allowed, expiry, state, order


def refresh(token, uid, acknowledge=False):
    payload = subscription(token)
    active, expires, state, order = evaluate(payload, uid)
    # A verified token is bound permanently; a client cannot move it to another account.
    c = db()
    try:
        with c:
            row = c.execute("SELECT uid FROM purchases WHERE token=?", (token,)).fetchone()
            if row and row["uid"] != uid:
                raise HTTPException(403, "구매 계정이 일치하지 않습니다.")
            c.execute("INSERT INTO purchases VALUES (?,?,?,?,?,?) ON CONFLICT(token) DO UPDATE SET state=excluded.state,expires=excluded.expires,order_id=excluded.order_id,updated=excluded.updated", (token, uid, state, expires, order, time.time()))
            if order:
                c.execute("INSERT OR IGNORE INTO orders VALUES (?,?,?)", (order, uid, token))
            # Retire linked tokens atomically after validating the new purchase's binding.
            linked = payload.get("linkedPurchaseToken") if payload else None
            if linked and active:
                c.execute("DELETE FROM purchases WHERE token=? AND uid=?", (linked, uid))
    finally:
        c.close()
    if acknowledge and active and payload.get("acknowledgementState") == "ACKNOWLEDGEMENT_STATE_PENDING":
        try:
            with google_session() as session:
                response = session.post(BASE + quote(PACKAGE, safe="") + "/purchases/subscriptions/" + quote(PRODUCT, safe="") + "/tokens/" + quote(token, safe="") + ":acknowledge", json={}, timeout=20)
                response.raise_for_status()
        except Exception:
            raise HTTPException(503, "구매 확인 응답이 지연되었습니다. 구매 복원을 다시 실행하세요.") from None
    return {"pro": active, "state": state, "expiresAt": expires}


def current_entitlement(uid):
    c = db()
    try:
        tokens = [r["token"] for r in c.execute("SELECT token FROM purchases WHERE uid=? ORDER BY updated DESC", (uid,))]
    finally:
        c.close()
    best = {"pro": False, "state": "NONE", "expiresAt": 0}
    for token in tokens:
        result = refresh(token, uid, acknowledge=True)
        if result["pro"]:
            return result
        if result["expiresAt"] > best["expiresAt"]:
            best = result
    return best


def pro_user(uid=Depends(user)):
    if not current_entitlement(uid)["pro"]:
        raise HTTPException(403, "활성 Pro 구독이 필요합니다.")
    return uid


class Receipt(BaseModel):
    purchaseToken: str = Field(min_length=8, max_length=4096)


class AccountDeletionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm: StrictBool

    @field_validator("confirm")
    @classmethod
    def explicitly_confirmed(cls, value):
        if value is not True:
            raise ValueError("계정 및 관련 데이터 삭제 요청을 확인해야 합니다.")
        return value


@app.post("/v1/account-deletion-requests")
def request_account_deletion(request: AccountDeletionRequest, uid=Depends(user)):
    """Receipt only. Never delete data or cancel a Play subscription here."""
    c = db()
    try:
        with c:
            c.execute("INSERT OR IGNORE INTO account_deletion_requests VALUES (?,?,?,?)",
                      (uuid.uuid4().hex, uid, datetime.now(timezone.utc).isoformat(), "RECEIVED"))
            row = c.execute("SELECT request_id,requested_at,status FROM account_deletion_requests WHERE uid=?", (uid,)).fetchone()
    finally:
        c.close()
    return JSONResponse({"requestId": row["request_id"], "requestedAt": row["requested_at"],
                         "status": row["status"], "deletionCompleted": False,
                         "message": "삭제 요청을 접수했습니다. 계정과 데이터 삭제는 아직 완료되지 않았습니다. Google Play 구독은 별도로 관리하세요."},
                        headers={"Cache-Control": "no-store"})


@app.get("/v1/admin/account-deletion-requests")
def account_deletion_requests(uid=Depends(user)):
    if uid not in ADMIN_UIDS:
        raise HTTPException(403, "운영자 권한이 필요합니다.")
    c = db()
    try:
        rows = c.execute("SELECT request_id AS requestId,uid,requested_at AS requestedAt,status FROM account_deletion_requests ORDER BY requested_at DESC LIMIT 500").fetchall()
    finally:
        c.close()
    return JSONResponse({"requests": [dict(r) for r in rows],
                         "note": "접수 내역입니다. 실제 삭제 처리와 구독 취소는 이 API에서 실행하지 않습니다."},
                        headers={"Cache-Control": "no-store"})


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/v1/config")
def config(uid=Depends(user)):
    # Detect missing publisher credentials before launching a chargeable billing flow.
    with google_session() as session:
        try:
            response = session.get(BASE + quote(PACKAGE, safe="") + "/subscriptions/" + quote(PRODUCT, safe=""), timeout=20)
            response.raise_for_status()
            product = response.json()
            if not any(p.get("state") == "ACTIVE" for p in product.get("basePlans", [])):
                raise ValueError("no active base plan")
        except Exception:
            raise HTTPException(503, "Play Pro 상품이 활성화되지 않았습니다.") from None
    return {"productId": PRODUCT, "feature": "private_video_vault", "quotaBytes": QUOTA}


@app.post("/v1/purchases/verify")
def verify(receipt: Receipt, uid=Depends(user)):
    return refresh(receipt.purchaseToken, uid, acknowledge=True)


@app.get("/v1/entitlement")
def entitlement(uid=Depends(user)):
    return current_entitlement(uid)


@app.post("/v1/videos", status_code=201)
async def upload(request: Request, uid=Depends(pro_user)):
    mime = request.headers.get("content-type", "").split(";")[0]
    if mime not in {"video/webm", "video/mp4"}:
        raise HTTPException(415, "지원하지 않는 영상 형식입니다.")
    folder = ROOT / "videos"
    folder.mkdir(parents=True, exist_ok=True)
    video_id = uuid.uuid4().hex
    temp = folder / (video_id + ".part")
    final = folder / video_id
    total = 0
    try:
        with temp.open("xb") as out:
            async for chunk in request.stream():
                total += len(chunk)
                if total > MAX_VIDEO:
                    raise HTTPException(413, "영상은 100 MiB 이하여야 합니다.")
                out.write(chunk)
        if total == 0:
            raise HTTPException(400, "빈 영상입니다.")
        # Basic container check; uploaded videos are never executed or served as HTML.
        with temp.open("rb") as video:
            prefix = video.read(12)
        if not ((mime == "video/webm" and prefix.startswith(b"\x1a\x45\xdf\xa3")) or (mime == "video/mp4" and prefix[4:8] == b"ftyp")):
            raise HTTPException(415, "영상 컨테이너가 형식과 일치하지 않습니다.")
        c = db()
        try:
            c.execute("BEGIN IMMEDIATE")
            used = c.execute("SELECT COALESCE(SUM(size),0) FROM videos WHERE uid=?", (uid,)).fetchone()[0]
            if used + total > QUOTA:
                raise HTTPException(413, "클라우드 보관 용량을 초과했습니다.")
            temp.rename(final)
            c.execute("INSERT INTO videos VALUES (?,?,?,?,?)", (video_id, uid, mime, total, datetime.now(timezone.utc).isoformat()))
            c.commit()
        except BaseException:
            c.rollback()
            final.unlink(missing_ok=True)
            raise
        finally:
            c.close()
    finally:
        temp.unlink(missing_ok=True)
    return {"id": video_id, "size": total}


@app.get("/v1/videos")
def videos(uid=Depends(pro_user)):
    c = db()
    try:
        rows = c.execute("SELECT id,mime,size,created AS createdAt FROM videos WHERE uid=? ORDER BY created DESC", (uid,)).fetchall()
        return {"videos": [dict(r) for r in rows]}
    finally:
        c.close()


@app.get("/v1/videos/{video_id}")
def download(video_id: str, uid=Depends(pro_user)):
    c = db()
    try:
        row = c.execute("SELECT * FROM videos WHERE id=? AND uid=?", (video_id, uid)).fetchone()
    finally:
        c.close()
    if not row:
        raise HTTPException(404, "영상을 찾을 수 없습니다.")
    return FileResponse(ROOT / "videos" / row["id"], media_type=row["mime"], filename="SV_SWING." + ("mp4" if row["mime"] == "video/mp4" else "webm"), headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@app.delete("/v1/videos/{video_id}", status_code=204)
def delete_video(video_id: str, uid=Depends(user)):
    # Owners can remove their data even after a subscription expires.
    c = db()
    try:
        with c:
            row = c.execute("SELECT id FROM videos WHERE id=? AND uid=?", (video_id, uid)).fetchone()
            if not row:
                raise HTTPException(404, "영상을 찾을 수 없습니다.")
            c.execute("DELETE FROM videos WHERE id=? AND uid=?", (video_id, uid))
        (ROOT / "videos" / row["id"]).unlink(missing_ok=True)
    finally:
        c.close()


@app.post("/v1/play/rtdn")
async def rtdn(request: Request, authorization: str | None = Header(default=None)):
    if not PUBSUB_AUDIENCE or not PUBSUB_EMAIL:
        raise HTTPException(503, "알림 인증이 설정되지 않았습니다.")
    try:
        claims = id_token.verify_oauth2_token(bearer(authorization), GoogleRequest(), audience=PUBSUB_AUDIENCE)
        if claims.get("email") != PUBSUB_EMAIL or claims.get("email_verified") is not True:
            raise ValueError("wrong service identity")
    except Exception:
        raise HTTPException(401, "알림 인증 실패") from None
    try:
        import base64
        envelope = await request.json()
        message = envelope["message"]
        message_id = message["messageId"]
        payload = json.loads(base64.b64decode(message["data"], validate=True))
    except Exception:
        raise HTTPException(400, "잘못된 알림") from None
    if payload.get("packageName") != PACKAGE:
        raise HTTPException(400, "패키지가 일치하지 않습니다.")
    c = db()
    try:
        if c.execute("SELECT 1 FROM notifications WHERE message_id=?", (message_id,)).fetchone():
            return {"ok": True}
        token = payload.get("subscriptionNotification", {}).get("purchaseToken") or payload.get("voidedPurchaseNotification", {}).get("purchaseToken")
        row = c.execute("SELECT uid FROM purchases WHERE token=?", (token,)).fetchone() if token else None
        if row:
            # Refund, revoke, renew, hold, cancel all re-read Play; no out-of-order grants.
            refresh(token, row["uid"], acknowledge=True)
        with c:
            c.execute("INSERT OR IGNORE INTO notifications VALUES (?,?)", (message_id, time.time()))
    finally:
        c.close()
    return {"ok": True}


@app.get("/v1/admin/orders")
def orders(uid=Depends(user)):
    if uid not in ADMIN_UIDS:
        raise HTTPException(403, "운영자 권한이 필요합니다.")
    c = db()
    try:
        rows = c.execute("SELECT o.uid,o.order_id,p.state,p.expires,p.updated FROM orders o LEFT JOIN purchases p ON p.token=o.token ORDER BY o.rowid DESC LIMIT 500").fetchall()
    finally:
        c.close()
    results = []
    for row in rows:
        item = dict(row)
        # Order amounts are retrieved from Google, never inferred from list prices.
        item["googleOrder"] = play_get("/orders/" + quote(row["order_id"], safe="")) if row["order_id"] else None
        results.append(item)
    return {"orders": results, "note": "Google 주문 원본. 정산 매출은 Play Console 재무 보고서로 확인하세요."}


@app.get("/operator", response_class=HTMLResponse)
def operator():
    return HTMLResponse((Path(__file__).parent / "operator.html").read_text(), headers={"Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", "Content-Security-Policy":"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://identitytoolkit.googleapis.com; frame-ancestors 'none'"})


@app.get("/v1/auth-config")
def auth_config():
    return {"apiKey": os.environ.get("SV_FIREBASE_API_KEY", "")}


@app.get("/account-deletion", response_class=HTMLResponse)
def account_deletion_page():
    return HTMLResponse((Path(__file__).parent / "account-deletion.html").read_text(), headers={
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' https://identitytoolkit.googleapis.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    })
