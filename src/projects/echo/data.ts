import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import { createBackupCredentials } from "../../backup-credentials";
import { required, settings } from "../../config";
import { dataNodeSelector } from "../node-selector";
import { echoConfig } from "./config";

const valkeyChart = { repository: "https://charts.bitnami.com/bitnami", version: "6.2.2" };

/**
 * Standard images bundle pgvector. ImageVolume sidecars need Kubernetes 1.33+;
 * orbit-eu runs 1.32, so minimal + postgresql.extensions does not mount /extensions.
 */
const echoPostgresImage = "ghcr.io/cloudnative-pg/postgresql:18-standard-trixie";

export function createEchoData(
    provider: k8s.Provider,
    namespace: k8s.core.v1.Namespace,
    cloudnativePg: k8s.helm.v3.Release,
    backupBucket: cloudflare.R2Bucket,
) {
    const postgresBootstrap = new k8s.core.v1.Secret("echo-postgres-bootstrap", {
        metadata: { namespace: namespace.metadata.name },
        stringData: {
            username: "echo",
            password: echoConfig.postgresPassword,
        },
    }, { provider });

    const backupCredentials = createBackupCredentials(provider, "echo", namespace, backupBucket);

    const echoPostgres = new k8s.apiextensions.CustomResource("echo-postgres", {
        apiVersion: "postgresql.cnpg.io/v1",
        kind: "Cluster",
        metadata: { namespace: namespace.metadata.name, name: "echo-postgres" },
        spec: {
            imageName: echoPostgresImage,
            instances: 1,
            resources: {
                requests: { cpu: "400m", memory: "768Mi" },
                limits: { cpu: "1000m", memory: "1536Mi" },
            },
            bootstrap: {
                initdb: {
                    database: "echo",
                    owner: "echo",
                    secret: { name: postgresBootstrap.metadata.name },
                },
            },
            storage: {
                storageClass: settings.storageClassName,
                size: "20Gi",
            },
            affinity: { nodeSelector: dataNodeSelector() },
            backup: {
                barmanObjectStore: {
                    destinationPath: `s3://${settings.cloudflare.backupBucketName}/cnpg/echo-postgres`,
                    endpointURL: `https://${required.cloudflareAccountId}.eu.r2.cloudflarestorage.com`,
                    s3Credentials: {
                        accessKeyId: { name: backupCredentials.metadata.name, key: "ACCESS_KEY_ID" },
                        secretAccessKey: { name: backupCredentials.metadata.name, key: "SECRET_ACCESS_KEY" },
                    },
                },
                retentionPolicy: "14d",
            },
        },
    }, { provider, dependsOn: [cloudnativePg, postgresBootstrap, backupCredentials] });

    const echoPostgresDatabase = new k8s.apiextensions.CustomResource("echo-postgres-database", {
        apiVersion: "postgresql.cnpg.io/v1",
        kind: "Database",
        metadata: { namespace: namespace.metadata.name, name: "echo-postgres-database" },
        spec: {
            name: "echo",
            owner: "echo",
            cluster: { name: "echo-postgres" },
            ensure: "present",
            databaseReclaimPolicy: "retain",
            extensions: [{ name: "vector", ensure: "present" }],
        },
    }, { provider, dependsOn: echoPostgres });

    const echoValkey = new k8s.helm.v3.Release("echo-valkey", {
        name: "echo-valkey",
        chart: "valkey",
        version: valkeyChart.version,
        repositoryOpts: { repo: valkeyChart.repository },
        namespace: namespace.metadata.name,
        values: {
            architecture: "standalone",
            auth: { enabled: true, password: echoConfig.valkeyPassword },
            primary: {
                persistence: { enabled: true, storageClass: settings.storageClassName, size: "4Gi" },
                resources: {
                    requests: { cpu: "150m", memory: "256Mi" },
                    limits: { cpu: "400m", memory: "512Mi" },
                },
                nodeSelector: dataNodeSelector(),
            },
        },
    }, { provider });

    const echoPostgresBackup = new k8s.apiextensions.CustomResource("echo-postgres-backup", {
        apiVersion: "postgresql.cnpg.io/v1",
        kind: "ScheduledBackup",
        metadata: { namespace: namespace.metadata.name, name: "echo-postgres-daily" },
        spec: {
            schedule: "0 0 3 * * *",
            immediate: true,
            backupOwnerReference: "self",
            method: "barmanObjectStore",
            cluster: { name: echoPostgres.metadata.name },
        },
    }, { provider, dependsOn: echoPostgres });

    return {
        echoPostgres,
        echoPostgresDatabase,
        echoPostgresBackup,
        backupCredentials,
        echoPostgresService: "echo-postgres-rw.echo.svc.cluster.local",
        echoValkey,
        echoValkeyService: "echo-valkey-primary.echo.svc.cluster.local",
    };
}
