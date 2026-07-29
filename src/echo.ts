import * as k8s from "@pulumi/kubernetes";
import { required } from "./config";
import { createGhcrPullSecret } from "./ghcr";
import type { Namespaces } from "./namespaces";

const infisicalProjectSlug = "echo-cn33";
const infisicalEnvironmentSlug = "prod";
const infisicalHostApi = "http://infisical-infisical-standalone-infisical.secrets.svc.cluster.local:8080/api";

const secretSyncTargets = [
    { name: "echo-shared-secrets", path: "/shared" },
    { name: "echo-api-secrets", path: "/api" },
    { name: "echo-worker-secrets", path: "/worker" },
] as const;

export function createEchoSecrets(
    provider: k8s.Provider,
    namespaces: Namespaces,
    infisicalOperator: k8s.helm.v3.Release,
) {
    const ghcrPullSecret = createGhcrPullSecret(provider, "echo", namespaces.echo.metadata.name);

    const universalAuthCredentials = new k8s.core.v1.Secret("infisical-echo-universal-auth", {
        metadata: { namespace: namespaces.echo.metadata.name },
        stringData: {
            clientId: required.echoInfisicalUniversalAuthClientId,
            clientSecret: required.echoInfisicalUniversalAuthClientSecret,
        },
    }, { provider });

    const secretSyncs = secretSyncTargets.map(
        ({ name, path }) =>
            new k8s.apiextensions.CustomResource(name, {
                apiVersion: "secrets.infisical.com/v1alpha1",
                kind: "InfisicalSecret",
                metadata: { namespace: namespaces.echo.metadata.name, name },
                spec: {
                    hostAPI: infisicalHostApi,
                    resyncInterval: 60,
                    authentication: {
                        universalAuth: {
                            credentialsRef: {
                                secretName: universalAuthCredentials.metadata.name,
                                secretNamespace: namespaces.echo.metadata.name,
                            },
                            secretsScope: {
                                projectSlug: infisicalProjectSlug,
                                envSlug: infisicalEnvironmentSlug,
                                secretsPath: path,
                            },
                        },
                    },
                    managedKubeSecretReferences: [
                        {
                            secretName: name,
                            secretNamespace: namespaces.echo.metadata.name,
                            creationPolicy: "Orphan",
                        },
                    ],
                },
            }, { provider, dependsOn: [infisicalOperator, universalAuthCredentials] }),
    );

    return { ghcrPullSecret, universalAuthCredentials, secretSyncs };
}
