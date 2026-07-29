import * as k8s from "@pulumi/kubernetes";

const namespaceDefinitions = {
    platform: "platform",
    edge: "edge",
    data: "data",
    secrets: "secrets",
    observability: "observability",
    echo: "echo",
} as const;

export type NamespaceName = keyof typeof namespaceDefinitions;
export type Namespaces = Record<NamespaceName, k8s.core.v1.Namespace>;

export function createNamespaces(provider: k8s.Provider): Namespaces {
    return Object.fromEntries(
        Object.entries(namespaceDefinitions).map(([key, name]) => {
            const namespace = new k8s.core.v1.Namespace(name, {
                metadata: {
                    name,
                    labels: {
                        "app.kubernetes.io/part-of": "orbit",
                        "pod-security.kubernetes.io/enforce": name === "observability" ? "privileged" : "baseline",
                    },
                },
            }, { provider });

            return [key, namespace];
        }),
    ) as unknown as Namespaces;
}
