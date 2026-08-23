import * as k8s from "@pulumi/kubernetes";

export function createProjectNamespace(provider: k8s.Provider, name: string) {
    return new k8s.core.v1.Namespace(name, {
        metadata: {
            name,
            labels: {
                "app.kubernetes.io/part-of": name,
                "pod-security.kubernetes.io/enforce": "baseline",
            },
        },
    }, { provider });
}
