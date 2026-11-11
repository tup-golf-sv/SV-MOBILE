# Account deletion worker — isolated implementation, not production enabled

The HTTP request endpoint only records a user's explicit request. Nothing starts
this worker automatically. The default `process_request` call is disabled and the
CLI additionally requires `SV_ACCOUNT_DELETION_WORKER_ENABLED=1` plus one stored
request ID. Do not enable it in production before owner approval, deletion policy
review and Firebase IAM/project verification.

The adapter uses the official OAuth-authenticated Firebase/Identity Platform
`projects.accounts.delete` API, scoped to `SV_FIREBASE_PROJECT`. It requires
`firebaseauth.users.delete`; credentials are obtained using application default
credentials. No service-account key is stored in source.

State is stored separately from original requests, so the existing RECEIVED-only
table does not require destructive rebuilding. A job moves from RECEIVED (no job
row) to PROCESSING, then COMPLETED or FAILED. A failed job may be retried. A live
PROCESSING claim is not processed again; a claim older than five minutes can be
reclaimed. Firebase USER_NOT_FOUND is accepted only as an idempotent deletion
outcome. Other errors leave deletionCompleted false. The worker never calls a
Google Play cancellation or refund API.

After Firebase deletion succeeds, only the stored request owner's video files,
video rows, purchase rows and order rows are removed. Operations are restricted
by UID; a file ID must be the generated 32-character lowercase hexadecimal form.
Deletion job/request audit records remain, including the UID. The appropriate
retention, lawful exceptions, backups, access logs and notice policy are UNKNOWN
and must be resolved before claiming complete privacy-policy compliance.

Started/failed/completed jobs block API use by that UID, including otherwise valid
pre-deletion ID tokens. Receipt writes and upload commits recheck the block in a
database write transaction to stop in-flight operations recreating deleted rows.

Tests use temporary databases/files, mock identity and a fake Firebase deleter.
Actual Firebase account deletion, production credentials, worker scheduling,
operations approval, customer notice and production retention are UNKNOWN.

Official references:
- https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/delete
- https://firebase.google.com/docs/auth/admin/manage-users#delete_a_user

No actual Google user deletion or subscription cancellation was run during this work.
