import * as cloudflare from "@pulumi/cloudflare";
import { required } from "../../config";
import { echoConfig } from "./config";

/**
 * The `echo-storage` bucket was created manually through the Cloudflare
 * dashboard before it was imported into this stack, and it landed outside
 * the EU jurisdiction. R2 bucket jurisdiction is immutable after creation,
 * so `jurisdiction`/`location` are intentionally left unset here to match
 * the real resource — setting them would make Pulumi try to replace the
 * bucket. New buckets created from scratch (see `backups` in `src/edge.ts`)
 * should set `jurisdiction: "eu"` from the start instead.
 *
 * This module only provisions bucket infrastructure. The application's R2
 * API credentials (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`, consumed by
 * `apps/api` and `apps/worker` in the echo repository) are not managed by
 * Pulumi: create a scoped Cloudflare R2 API token for this bucket in the
 * dashboard and store it directly in Infisical under the echo project's
 * `/api` and `/worker` paths. The `InfisicalSecret` syncs in `secrets.ts`
 * already deliver those paths into the cluster alongside the rest of
 * echo's application secrets.
 */
export function createEchoStorage() {
  const bucket = new cloudflare.R2Bucket("echo-storage", {
    accountId: required.cloudflareAccountId,
    name: echoConfig.storageBucketName,
  });

  const cors = new cloudflare.R2BucketCors("echo-storage-cors", {
    accountId: required.cloudflareAccountId,
    bucketName: bucket.name,
    rules: [
      {
        allowed: {
          methods: ["PUT"],
          origins: [echoConfig.webOrigin, "http://localhost:3000"],
          headers: ["Content-Type"],
        },
        exposeHeaders: ["ETag"],
        maxAgeSeconds: 3600,
      },
    ],
  });

  const lifecycle = new cloudflare.R2BucketLifecycle("echo-storage-lifecycle", {
    accountId: required.cloudflareAccountId,
    bucketName: bucket.name,
    rules: [
      {
        id: "expire-knowledge-uploads",
        enabled: true,
        conditions: { prefix: "knowledge/uploads/" },
        deleteObjectsTransition: { condition: { type: "Age", maxAge: 86400 } },
      },
    ],
  });

  return { bucket, cors, lifecycle };
}
