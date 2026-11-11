#!/usr/bin/env python3
"""Read-only preflight. Never prints configuration values or contacts Google."""
import json
import os
import sys
from urllib.parse import urlsplit


def check(env):
    results = []
    def add(name, passed, reason):
        results.append({"check": name, "status": "PASS" if passed else "BLOCKED", "reason": reason})
    for key in ("SV_API_BASE", "SV_FIREBASE_API_KEY", "SV_FIREBASE_PROJECT", "SV_PUBSUB_AUDIENCE", "SV_PUBSUB_EMAIL", "SV_ADMIN_UIDS", "SV_DATA_DIR"):
        add(key, bool(env.get(key, "").strip()), "present" if env.get(key, "").strip() else "missing")
    base = env.get("SV_API_BASE", "").rstrip("/")
    try:
        parsed = urlsplit(base)
    except ValueError:
        parsed = urlsplit("")
    add("private_https_backend", parsed.scheme == "https" and bool(parsed.hostname) and parsed.hostname not in {"localhost", "127.0.0.1", "::1"} and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment, "HTTPS backend required; availability not checked")
    add("rtdn_audience_matches_backend", bool(base) and env.get("SV_PUBSUB_AUDIENCE") == base + "/v1/play/rtdn", "exact backend RTDN audience required")
    add("package_matches_apk", env.get("SV_PACKAGE", "kr.co.tupgolf.svmobile") == "kr.co.tupgolf.svmobile", "must match Android applicationId")
    add("product_matches_apk", env.get("SV_PRO_PRODUCT", "sv_mobile_pro") == "sv_mobile_pro", "must match current Android product")
    add("persistent_data_path", os.path.isabs(env.get("SV_DATA_DIR", "")), "absolute persistent mount path required; mount not checked")
    return {"scope": "local configuration only; no credentials printed; no external requests", "checks": results, "live_play_auth": "UNKNOWN", "real_purchase": "UNKNOWN"}


if __name__ == "__main__":
    report = check(os.environ)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    sys.exit(1 if any(c["status"] == "BLOCKED" for c in report["checks"]) else 0)
