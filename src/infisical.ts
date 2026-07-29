import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { required, settings } from "./config";
import type { Namespaces } from "./namespaces";

const chart = {
    repository: "https://dl.cloudsmith.io/public/infisical/helm-charts/helm/charts/",
    version: "1.10.0",
};

export function createInfisical(
    provider: k8s.Provider,
    namespaces: Namespaces,
    cloudnativePg: k8s.helm.v3.Release,
) {
    const smtp: pulumi.Output<Record<string, string>> = pulumi.all([
        settings.infisical.resendApiKey,
        settings.infisical.smtpFromAddress,
    ]).apply<Record<string, string>>(([apiKey, fromAddress]) => {
        if (apiKey === undefined && fromAddress === undefined) {
            return {} as Record<string, string>;
        }
        if (apiKey === undefined || fromAddress === undefined) {
            throw new Error(
                "Set both orbit:infisicalResendApiKey and orbit:infisicalSmtpFromAddress to enable Infisical email.",
            );
        }

        return {
            SMTP_HOST: "smtp.resend.com",
            SMTP_PORT: "587",
            SMTP_USERNAME: "resend",
            SMTP_PASSWORD: apiKey,
            SMTP_FROM_ADDRESS: fromAddress,
            SMTP_FROM_NAME: settings.infisical.smtpFromName,
            SMTP_REQUIRE_TLS: "true",
            SMTP_TLS_REJECT_UNAUTHORIZED: "true",
        } as Record<string, string>;
    });

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

    const rootCredentialsData: pulumi.Output<Record<string, string>> = pulumi.all([
        required.infisicalEncryptionKey,
        required.infisicalAuthSecret,
        required.infisicalSiteUrl,
        smtp,
    ]).apply<Record<string, string>>(([encryptionKey, authSecret, siteUrl, smtpSettings]) => ({
        ENCRYPTION_KEY: encryptionKey,
        AUTH_SECRET: authSecret,
        HOST: "0.0.0.0",
        SITE_URL: siteUrl,
        TELEMETRY_ENABLED: "false",
        DISABLE_UPDATE_CHECK: "true",
        ...smtpSettings,
    }));

    const rootCredentials = new k8s.core.v1.Secret("infisical-root-credentials", {
        metadata: { namespace: namespaces.secrets.metadata.name, name: "infisical-secrets" },
        stringData: rootCredentialsData as unknown as pulumi.Input<Record<string, pulumi.Input<string>>>,
    }, { provider });

    const instance = new k8s.helm.v3.Release("infisical", {
        name: "infisical",
        chart: "infisical-standalone",
        version: chart.version,
        repositoryOpts: { repo: chart.repository },
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
