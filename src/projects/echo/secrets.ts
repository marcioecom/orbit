import * as k8s from "@pulumi/kubernetes";
import { createGhcrPullSecret } from "../../ghcr";
import { echoConfig } from "./config";

const infisicalEnvironmentSlug = "prod";
const infisicalHostApi = "http://infisical-infisical-standalone-infisical.secrets.svc.cluster.local:8080/api";
const secretSyncTargets = [
    { name: "echo-shared-secrets", path: "/shared" },
    { name: "echo-api-secrets", path: "/api" },
    { name: "echo-worker-secrets", path: "/worker" },
] as const;

export function createEchoSecrets(
    provider: k8s.Provider,
    namespace: k8s.core.v1.Namespace,
    infisicalOperator: k8s.helm.v3.Release,
) {
    const ghcrPullSecret = createGhcrPullSecret(provider, "echo", namespace.metadata.name);
    const universalAuthCredentials = new k8s.core.v1.Secret("infisical-echo-universal-auth", {
        metadata: { namespace: namespace.metadata.name },
        stringData: {
            clientId: echoConfig.infisicalUniversalAuthClientId,
            clientSecret: echoConfig.infisicalUniversalAuthClientSecret,
        },
    }, { provider });
    const secretSyncs = secretSyncTargets.map(({ name, path }) => new k8s.apiextensions.CustomResource(name, {
        apiVersion: "secrets.infisical.com/v1alpha1",
        kind: "InfisicalSecret",
        metadata: { namespace: namespace.metadata.name, name },
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
                        projectSlug: echoConfig.infisicalProjectSlug,
                        envSlug: infisicalEnvironmentSlug,
                        secretsPath: path,
                    },
                },
            },
            managedKubeSecretReferences: [{
                secretName: name,
                secretNamespace: namespace.metadata.name,
                creationPolicy: "Orphan",
            }],
        },
    }, { provider, dependsOn: [infisicalOperator, universalAuthCredentials] }));

    return { ghcrPullSecret, universalAuthCredentials, secretSyncs };
}
