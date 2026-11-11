"""Explicitly operated deletion worker; never run by API startup or a request.

Production execution requires separate policy/credential verification and approval.
Play subscriptions are deliberately not cancelled by this worker.
"""
import os
import re
import time
import uuid
from urllib.parse import quote

import google.auth
from google.auth.transport.requests import AuthorizedSession

from server import app as service


class FirebaseAccountDeleter:
    def __init__(self, project):
        if not project:
            raise ValueError("Firebase project must be configured")
        self.project = project

    def delete(self, uid):
        # Official projects.accounts.delete: firebaseauth.users.delete permission.
        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        url = "https://identitytoolkit.googleapis.com/v1/projects/" + quote(self.project, safe="") + "/accounts:delete"
        with AuthorizedSession(credentials) as session:
            response = session.post(url, json={"localId": uid}, timeout=30)
            if response.status_code == 400:
                error = response.json().get("error", {}).get("message", "")
                if error == "USER_NOT_FOUND":
                    return  # Idempotent recovery after a crash following remote deletion.
            response.raise_for_status()


def process_request(request_id, deleter=None, *, enabled=False, now=None):
    """Process a stored request only; no arbitrary UID or automatic batch execution."""
    if enabled is not True:
        raise RuntimeError("Account deletion worker is disabled")
    now = time.time() if now is None else now
    owner = uuid.uuid4().hex
    c = service.db()
    try:
        with c:
            c.execute("BEGIN IMMEDIATE")
            row = c.execute("SELECT uid FROM account_deletion_requests WHERE request_id=?", (request_id,)).fetchone()
            if not row:
                raise ValueError("Unknown deletion request")
            uid = row["uid"]
            job = c.execute("SELECT state,updated FROM account_deletion_jobs WHERE request_id=?", (request_id,)).fetchone()
            if job and job["state"] == "COMPLETED":
                return {"status": "COMPLETED", "deletionCompleted": True}
            if job and job["state"] == "PROCESSING" and job["updated"] > now - 300:
                return {"status": "PROCESSING", "deletionCompleted": False}
            c.execute("INSERT INTO account_deletion_jobs VALUES (?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET state='PROCESSING',owner=excluded.owner,updated=excluded.updated,error_code=''",
                      (request_id, "PROCESSING", owner, now, ""))
        try:
            (deleter or FirebaseAccountDeleter(service.PROJECT)).delete(uid)
            with c:
                c.execute("BEGIN IMMEDIATE")
                job = c.execute("SELECT owner,state FROM account_deletion_jobs WHERE request_id=?", (request_id,)).fetchone()
                if job["owner"] != owner or job["state"] != "PROCESSING":
                    return {"status": "PROCESSING", "deletionCompleted": False}
                videos = c.execute("SELECT id FROM videos WHERE uid=?", (uid,)).fetchall()
                for video in videos:
                    if not re.fullmatch(r"[0-9a-f]{32}", video["id"]):
                        raise ValueError("Unsafe video identifier")
                    (service.ROOT / "videos" / video["id"]).unlink(missing_ok=True)
                c.execute("DELETE FROM videos WHERE uid=?", (uid,))
                c.execute("DELETE FROM orders WHERE uid=?", (uid,))
                c.execute("DELETE FROM purchases WHERE uid=?", (uid,))
                c.execute("UPDATE account_deletion_jobs SET state='COMPLETED',updated=?,error_code='' WHERE request_id=? AND owner=?", (time.time(), request_id, owner))
            return {"status": "COMPLETED", "deletionCompleted": True}
        except Exception:
            # Never expose access tokens, remote error payloads, or personal data.
            with c:
                c.execute("UPDATE account_deletion_jobs SET state='FAILED',updated=?,error_code='DELETION_FAILED' WHERE request_id=? AND owner=? AND state='PROCESSING'", (time.time(), request_id, owner))
            return {"status": "FAILED", "deletionCompleted": False}
    finally:
        c.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Process one approved account deletion request")
    parser.add_argument("--request-id", required=True)
    args = parser.parse_args()
    if os.environ.get("SV_ACCOUNT_DELETION_WORKER_ENABLED") != "1":
        parser.error("SV_ACCOUNT_DELETION_WORKER_ENABLED must be explicitly enabled after approval")
    print(process_request(args.request_id, enabled=True))
