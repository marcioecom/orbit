import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import { createProjectNamespace } from "../namespace";
import { createNightmintData } from "./data";
import { createNightmintSecrets } from "./secrets";

export function createNightmintProject(
    provider: k8s.Provider,
    dependencies: {
        cloudnativePg: k8s.helm.v3.Release;
        infisicalOperator: k8s.helm.v3.Release;
        backupBucket: cloudflare.R2Bucket;
    },
) {
    const namespace = createProjectNamespace(provider, "nightmint");
    const secrets = createNightmintSecrets(provider, namespace, dependencies.infisicalOperator);
    const data = createNightmintData(
        provider,
        namespace,
        dependencies.cloudnativePg,
        dependencies.backupBucket,
        secrets.postgresBootstrapSync,
    );

    return {
        namespace,
        ...secrets,
        ...data,
    };
}
