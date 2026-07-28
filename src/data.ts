import * as k8s from "@pulumi/kubernetes";
import { required, settings } from "./config";
import type { Namespaces } from "./namespaces";

const valkeyChart = { repo: "https://charts.bitnami.com/bitnami", version: "6.2.2" };

function dataNodeSelector() {
    if (settings.dataNodeSelector === "") {
        return undefined;
    }

    const [key, value] = settings.dataNodeSelector.split("=", 2);
    if (key === undefined || value === undefined || key === "" || value === "") {
        throw new Error("orbit:dataNodeSelector must use the format label=value.");
    }

    return { [key]: value };
}

export function createDataServices(
    provider: k8s.Provider,
    namespaces: Namespaces,
    cloudnativePg: k8s.helm.v3.Chart,
    backupCredentials: k8s.core.v1.Secret,
) {
    const postgresBootstrap = new k8s.core.v1.Secret("echo-postgres-bootstrap", {
        metadata: { namespace: namespaces.echo.metadata.name },
        stringData: {
            username: "echo",
            password: required.echoPostgresPassword,
        },
    }, { provider });

    const echoPostgres = new k8s.apiextensions.CustomResource("echo-postgres", {
        apiVersion: "postgresql.cnpg.io/v1",
        kind: "Cluster",
        metadata: { namespace: namespaces.echo.metadata.name, name: "echo-postgres" },
        spec: {
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
            affinity: {
                nodeSelector: dataNodeSelector(),
            },
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

    const echoValkey = new k8s.helm.v3.Chart("echo-valkey", {
        chart: "valkey",
        ...valkeyChart,
        namespace: namespaces.echo.metadata.name,
        values: {
            architecture: "standalone",
            auth: { enabled: true, password: required.echoValkeyPassword },
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
        metadata: { namespace: namespaces.echo.metadata.name, name: "echo-postgres-daily" },
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
        echoPostgresBackup,
        echoPostgresService: "echo-postgres-rw.echo.svc.cluster.local",
        echoValkey,
        echoValkeyService: "echo-valkey-primary.echo.svc.cluster.local",
    };
}
