---
name: ongale-storage
description: Store and serve files (uploads, images, exports) from an app on Ongale using its bucket via the S3_* environment variables. Use when the app saves files, handles uploads, or currently writes them to local disk on Ongale.
---

# Store files from an app on Ongale

Every Ongale project has a private S3 bucket. Its apps get, at every deploy:

`S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`

Any S3-compatible library works. For local development or CI, the user creates a key under **Storage → Access keys → New key** in Ongale (the secret is shown once, so the user keeps it; don't ask for it in the chat) and uses `https://s3.ongale.dev`, region `auto` and the project's bucket name. Use these for uploads and anything that must survive a redeploy; don't write such files to local disk.

## Rules

- Always pass `S3_ENDPOINT` as the endpoint and `S3_REGION` as the region, and use **path-style addressing** (`S3_FORCE_PATH_STYLE` is `true`); virtual-hosted buckets (`<bucket>.s3.…`) don't resolve.
- A single request body can be at most 100 MB: upload bigger files in parts (`@aws-sdk/lib-storage`'s `Upload`, boto3's `upload_fileobj`).
- Files count toward the plan's storage, shared with Media; an upload that doesn't fit fails with `QuotaExceeded`. Show the user a clear message for it.
- Browsers can upload straight to the bucket with a presigned PUT URL (CORS is allowed), which keeps large uploads off the app.
- The bucket is private. Serve files through the app (stream them) or with short-lived presigned URLs; don't try to make the bucket public.
- Never log or print the keys.
- Prefix object keys per feature or user (`avatars/<user-id>.png`) and validate file types and sizes before uploading.

## Node (AWS SDK v3)

```js
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});
const Bucket = process.env.S3_BUCKET;

await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: buffer, ContentType: type }));
const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: 600 });
```

## Python (boto3)

```python
import os, boto3
from botocore.config import Config

s3 = boto3.client("s3", config=Config(s3={"addressing_style": "path"}),
    endpoint_url=os.environ["S3_ENDPOINT"], region_name=os.environ["S3_REGION"],
    aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"], aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"])
bucket = os.environ["S3_BUCKET"]

s3.upload_fileobj(fileobj, bucket, key, ExtraArgs={"ContentType": content_type})
url = s3.generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=600)
```

## With the Ongale MCP server

See `ongale-mcp` for connecting and the rules.

- `buckets_list` shows the buckets, the endpoint and the key ids (never secrets); `usage_get` shows storage used against the plan. `app_env_list` confirms an app has the `S3_*` names.
- **A second key** (e.g. read-only for a reporting app): `bucket_key_create` stores it in the app as secret variables (`EXTRA_S3_*` by default); the secret is never shown. `bucket_key_revoke` removes it (`confirm: true`).
- **Media library** (images and files the user manages in Ongale): `media_list` and `media_get_link`. To upload one, `media_upload_url` gives a short-lived URL for the file's bytes, then `media_upload_complete`. Never pass file bytes through the chat.

## Moving off local disk

Find where the app writes uploads (e.g. `multer` disk storage, `public/uploads`, `MEDIA_ROOT`) and switch it to the bucket, keeping the same URLs working through a small route that streams or redirects to a presigned URL.
