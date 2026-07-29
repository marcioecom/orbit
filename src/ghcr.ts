import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { required } from "./config";

export function createGhcrPullSecret(provider: k8s.Provider, project: string, namespace: pulumi.Input<string>) {
    return new k8s.core.v1.Secret(`ghcr-pull-secret-${project}`, {
        metadata: { name: "ghcr-pull-secret", namespace },
        type: "kubernetes.io/dockerconfigjson",
        stringData: {
            ".dockerconfigjson": pulumi
                .all([required.ghcrUsername, required.ghcrPullToken])
                .apply(([username, token]) =>
                    JSON.stringify({
                        auths: {
                            "ghcr.io": {
                                username,
                                password: token,
                                auth: Buffer.from(`${username}:${token}`).toString("base64"),
                            },
                        },
                    }),
                ),
        },
    }, { provider });
}
