import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import { createBackupCredentials } from "../../backup-credentials";
import { required, settings } from "../../config";
import { dataNodeSelector } from "../node-selector";

export function createNightmintData(
    provider: k8s.Provider,
    namespace: k8s.core.v1.Namespace,
    cloudnativePg: k8s.helm.v3.Release,
    backupBucket: cloudflare.R2Bucket,
    postgresBootstrapSync: k8s.apiextensions.CustomResource,
) {
    const backupCredentials = createBackupCredentials(provider, "nightmint", namespace, backupBucket);

    // InfisicalSecret reconciliation is asynchronous. CNPG retries initdb until
    // the managed bootstrap Secret exists; it does not need a hand-applied Secret.
    const postgres = new k8s.apiextensions.CustomResource("nightmint-postgres", {
        apiVersion: "postgresql.cnpg.io/v1",
        kind: "Cluster",
        metadata: {
            namespace: namespace.metadata.name,
            name: "nightmint-postgres",
            labels: {
                "app.kubernetes.io/name": "nightmint-postgres",
                "app.kubernetes.io/part-of": "nightmint",
            },
        },
        spec: {
            instances: 1,
            resources: {
                requests: { cpu: "200m", memory: "512Mi" },
                limits: { cpu: "500m", memory: "1Gi" },
            },
            bootstrap: {
                initdb: {
                    database: "nightmint_indexer",
                    owner: "nightmint",
                    secret: { name: "nightmint-postgres-bootstrap" },
                },
            },
            storage: {
                storageClass: settings.storageClassName,
                size: "10Gi",
            },
            affinity: {
                nodeSelector: dataNodeSelector(),
            },
            backup: {
                barmanObjectStore: {
                    destinationPath: `s3://${settings.cloudflare.backupBucketName}/cnpg/nightmint-postgres`,
                    endpointURL: `https://${required.cloudflareAccountId}.eu.r2.cloudflarestorage.com`,
                    s3Credentials: {
                        accessKeyId: { name: backupCredentials.metadata.name, key: "ACCESS_KEY_ID" },
                        secretAccessKey: { name: backupCredentials.metadata.name, key: "SECRET_ACCESS_KEY" },
                    },
                    data: { compression: "gzip" },
                    wal: { compression: "gzip" },
                },
                retentionPolicy: "2d",
            },
        },
    }, { provider, dependsOn: [cloudnativePg, postgresBootstrapSync, backupCredentials] });

    const postgresBackup = new k8s.apiextensions.CustomResource("nightmint-postgres-daily", {
        apiVersion: "postgresql.cnpg.io/v1",
        kind: "ScheduledBackup",
        metadata: {
            namespace: namespace.metadata.name,
            name: "nightmint-postgres-daily",
        },
        spec: {
            schedule: "0 0 3 * * *",
            immediate: true,
            backupOwnerReference: "self",
            method: "barmanObjectStore",
            cluster: { name: postgres.metadata.name },
        },
    }, { provider, dependsOn: postgres });

    return { backupCredentials, postgres, postgresBackup };
}
