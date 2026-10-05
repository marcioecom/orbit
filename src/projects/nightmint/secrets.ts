import * as k8s from "@pulumi/kubernetes";
import { createGhcrPullSecret } from "../../ghcr";
import { nightmintConfig } from "./config";

const infisicalHostApi = "http://infisical-infisical-standalone-infisical.secrets.svc.cluster.local:8080/api";
const infisicalEnvironmentSlug = "prod";

function createInfisicalSecretSync(
    provider: k8s.Provider,
    namespace: k8s.core.v1.Namespace,
    universalAuthCredentials: k8s.core.v1.Secret,
    name: string,
    secretsPath: string,
    managedSecretName: string,
    dependency: k8s.helm.v3.Release,
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
                        projectSlug: nightmintConfig.infisicalProjectSlug,
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

export function createNightmintSecrets(
    provider: k8s.Provider,
    namespace: k8s.core.v1.Namespace,
    infisicalOperator: k8s.helm.v3.Release,
) {
    const ghcrPullSecret = createGhcrPullSecret(provider, "nightmint", namespace.metadata.name);

    const universalAuthCredentials = new k8s.core.v1.Secret("infisical-nightmint-universal-auth", {
        metadata: { namespace: namespace.metadata.name },
        stringData: {
            clientId: nightmintConfig.infisicalUniversalAuthClientId,
            clientSecret: nightmintConfig.infisicalUniversalAuthClientSecret,
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

    return {
        ghcrPullSecret,
        universalAuthCredentials,
        postgresBootstrapSync,
        indexerSecrets,
        keeperSecrets,
        secretSyncs: [postgresBootstrapSync, indexerSecrets, keeperSecrets],
    };
}
