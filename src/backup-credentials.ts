import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { required } from "./config";

/**
 * Every CloudNativePG cluster backs up to the same shared R2 bucket
 * (see `backups` in `src/edge.ts`), scoped by destination path per project.
 * Each project namespace gets its own copy of the R2 credentials instead of
 * sharing one cluster-wide secret, so a compromised namespace cannot read
 * another project's backup credentials.
 */
export function createBackupCredentials(
    provider: k8s.Provider,
    project: string,
    namespace: k8s.core.v1.Namespace,
    backupBucket?: pulumi.Resource,
) {
    return new k8s.core.v1.Secret(`r2-${project}-backup-credentials`, {
        metadata: { namespace: namespace.metadata.name },
        stringData: {
            ACCESS_KEY_ID: required.backupAccessKeyId,
            SECRET_ACCESS_KEY: required.backupSecretAccessKey,
        },
    }, { provider, dependsOn: backupBucket });
}
