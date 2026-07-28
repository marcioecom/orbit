import * as k8s from "@pulumi/kubernetes";
import { required, settings } from "./config";
import type { Namespaces } from "./namespaces";

const chart = {
    repo: "https://dl.cloudsmith.io/public/infisical/helm-charts/helm/charts/",
    version: "1.10.0",
};

export function createInfisical(
    provider: k8s.Provider,
    namespaces: Namespaces,
    cloudnativePg: k8s.helm.v3.Chart,
) {
    const bootstrap = new k8s.core.v1.Secret("infisical-postgres-bootstrap", {
        metadata: { namespace: namespaces.secrets.metadata.name },
        stringData: {
            username: "infisical",
            password: required.infisicalPostgresPassword,
        },
    }, { provider });

    const database = new k8s.apiextensions.CustomResource("infisical-postgres", {
        apiVersion: "postgresql.cnpg.io/v1",
        kind: "Cluster",
        metadata: { namespace: namespaces.secrets.metadata.name, name: "infisical-postgres" },
        spec: {
            instances: 1,
            resources: {
                requests: { cpu: "250m", memory: "512Mi" },
                limits: { cpu: "600m", memory: "1Gi" },
            },
            bootstrap: {
                initdb: {
                    database: "infisical",
                    owner: "infisical",
                    secret: { name: bootstrap.metadata.name },
                },
            },
            storage: {
                storageClass: settings.storageClassName,
                size: "10Gi",
            },
        },
    }, { provider, dependsOn: [cloudnativePg, bootstrap] });

    const databaseConnection = new k8s.core.v1.Secret("infisical-postgres-connection", {
        metadata: { namespace: namespaces.secrets.metadata.name },
        stringData: {
            uri: required.infisicalPostgresPassword.apply(
                (password) => `postgresql://infisical:${encodeURIComponent(password)}@infisical-postgres-rw.secrets.svc.cluster.local:5432/infisical`,
            ),
        },
    }, { provider, dependsOn: database });

    const rootCredentials = new k8s.core.v1.Secret("infisical-root-credentials", {
        metadata: { namespace: namespaces.secrets.metadata.name, name: "infisical-secrets" },
        stringData: {
            ENCRYPTION_KEY: required.infisicalEncryptionKey,
            AUTH_SECRET: required.infisicalAuthSecret,
            TELEMETRY_ENABLED: "false",
        },
    }, { provider });

    const instance = new k8s.helm.v3.Chart("infisical", {
        chart: "infisical-standalone",
        ...chart,
        namespace: namespaces.secrets.metadata.name,
        values: {
            ingress: { enabled: false, nginx: { enabled: false } },
            postgresql: {
                enabled: false,
                useExistingPostgresSecret: {
                    enabled: true,
                    existingConnectionStringSecret: {
                        name: databaseConnection.metadata.name,
                        key: "uri",
                    },
                },
            },
            redis: {
                architecture: "standalone",
                auth: { password: required.infisicalRedisPassword },
                master: {
                    persistence: { enabled: true, storageClass: settings.storageClassName, size: "2Gi" },
                    resources: {
                        requests: { cpu: "100m", memory: "128Mi" },
                        limits: { cpu: "250m", memory: "256Mi" },
                    },
                },
            },
            infisical: {
                kubeSecretRef: rootCredentials.metadata.name,
                replicaCount: 1,
                resources: {
                    requests: { cpu: "250m", memory: "512Mi" },
                    limits: { cpu: "600m", memory: "1Gi" },
                },
            },
        },
    }, { provider, dependsOn: [database, databaseConnection, rootCredentials] });

    const tailnetIngress = new k8s.networking.v1.Ingress("infisical-tailnet", {
        metadata: {
            namespace: namespaces.secrets.metadata.name,
            annotations: {
                "tailscale.com/hostname": "infisical",
                "tailscale.com/tags": "tag:k8s",
            },
        },
        spec: {
            ingressClassName: "tailscale",
            defaultBackend: {
                service: {
                    name: "infisical-infisical-standalone-infisical",
                    port: { number: 8080 },
                },
            },
            tls: [{ hosts: ["infisical"] }],
        },
    }, { provider, dependsOn: instance });

    return { database, instance, tailnetIngress };
}
