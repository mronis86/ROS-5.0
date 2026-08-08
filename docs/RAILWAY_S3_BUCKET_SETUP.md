# Railway Storage Bucket — cue asset uploads

ROS can store cue **Assets** on a Railway bucket. Uploaded files **auto-delete after 4 months**. For long-term files, operators should keep using Dropbox / Drive / OneDrive links.

## 1. Create the bucket

1. Railway project canvas → **+ New** → **Bucket**
2. Name it (e.g. `ros-cue-assets`) and pick a **region** (cannot change later)
3. Wait until the bucket is active

## 2. Wire credentials to api-server

1. Open the bucket → **Credentials**
2. Open **api-server** → **Variables**
3. Prefer **Variable References → AWS SDK** preset (auto-fills AWS_* names)
4. Also add **`BUCKET`** (or `AWS_S3_BUCKET`) referencing the bucket’s `BUCKET` value — the AWS preset sometimes omits the bucket name

Or set these manually (names Railway injects):

```
BUCKET_NAME
BUCKET_ENDPOINT
BUCKET_ACCESS_KEY_ID
BUCKET_SECRET_ACCESS_KEY
BUCKET_REGION
```

Aliases also work: `BUCKET`, `ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`.

4. **Redeploy** api-server

## 3. Confirm

After deploy, ROS Assets modal should say platform upload is available.  
`GET /api/event-cue-files/status` returns `{ "configured": true, "retentionMonths": 4 }`.

Local `.env` template: `docs/env-templates/railway-s3-bucket.env.example`
