import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { required, settings } from "../config";
import { dataNodeSelector } from "../data";
import { createGhcrPullSecret } from "../ghcr";
import { createProjectNamespace } from "./namespace";

const infisicalHostApi = "http://infisical-infisical-standalone-infisical.secrets.svc.cluster.local:8080/api";
const infisicalEnvironmentSlug = "prod";
const config = new pulumi.Config("nightmint");

const project = {
    infisicalProjectSlug: config.require("infisicalProjectSlug"),
    infisicalUniversalAuthClientId: config.requireSecret("infisicalUniversalAuthClientId"),
    infisicalUniversalAuthClientSecret: config.requireSecret("infisicalUniversalAuthClientSecret"),
};

function createInfisicalSecretSync(
    provider: k8s.Provider,
    namespace: k8s.core.v1.Namespace,
    universalAuthCredentials: k8s.core.v1.Secret,
    name: string,
    secretsPath: string,
    managedSecretName: string,
    dependency: pulumi.Resource,
) {
    return new k8s.apiextensions.CustomResource(name, {
        apiVersion: "secrets.infisical.com/v1alpha1",
        kind: "InfisicalSecret",
        metadata: {
            namespace: namespace.metadata.name,
            name,
            labels: {
                "app.kubernetes.io/part-of": "nightmint",
            },
        },
        spec: {
            hostAPI: infisicalHostApi,
            resyncInterval: 60,
            authentication: {
                universalAuth: {
                    credentialsRef: {
                        secretName: universalAuthCredentials.metadata.name,
                        secretNamespace: namespace.metadata.name,
                    },
                    secretsScope: {
                        projectSlug: project.infisicalProjectSlug,
                        envSlug: infisicalEnvironmentSlug,
                        secretsPath,
                    },
                },
            },
            managedKubeSecretReferences: [{
                secretName: managedSecretName,
                secretNamespace: namespace.metadata.name,
                creationPolicy: "Orphan",
            }],
        },
    }, { provider, dependsOn: [dependency, universalAuthCredentials] });
}

export function createNightmintProject(
    provider: k8s.Provider,
    cloudnativePg: k8s.helm.v3.Release,
    infisicalOperator: k8s.helm.v3.Release,
) {
    const namespace = createProjectNamespace(provider, "nightmint");
    const ghcrPullSecret = createGhcrPullSecret(provider, "nightmint", namespace.metadata.name);

    const universalAuthCredentials = new k8s.core.v1.Secret("infisical-nightmint-universal-auth", {
        metadata: { namespace: namespace.metadata.name },
        stringData: {
            clientId: project.infisicalUniversalAuthClientId,
            clientSecret: project.infisicalUniversalAuthClientSecret,
        },
    }, { provider });

    const postgresBootstrapSync = createInfisicalSecretSync(
        provider,
        namespace,
        universalAuthCredentials,
        "nightmint-postgres-bootstrap-sync",
        "/postgres",
        "nightmint-postgres-bootstrap",
        infisicalOperator,
    );
    const indexerSecrets = createInfisicalSecretSync(
        provider,
        namespace,
        universalAuthCredentials,
        "nightmint-indexer-secrets",
        "/indexer",
        "nightmint-indexer-secrets",
        infisicalOperator,
    );
    const keeperSecrets = createInfisicalSecretSync(
        provider,
        namespace,
        universalAuthCredentials,
        "nightmint-keeper-secrets",
        "/keeper",
        "nightmint-keeper-secrets",
        infisicalOperator,
    );

    const backupCredentials = new k8s.core.v1.Secret("r2-nightmint-backup-credentials", {
        metadata: { namespace: namespace.metadata.name },
        stringData: {
            ACCESS_KEY_ID: required.backupAccessKeyId,
            SECRET_ACCESS_KEY: required.backupSecretAccessKey,
        },
    }, { provider });

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
                },
                retentionPolicy: "14d",
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


    return {
        namespace,
        ghcrPullSecret,
        universalAuthCredentials,
        postgresBootstrapSync,
        indexerSecrets,
        keeperSecrets,
        backupCredentials,
        postgres,
        postgresBackup,
    };
}
