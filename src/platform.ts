import * as k8s from "@pulumi/kubernetes";
import { required, settings } from "./config";
import type { Namespaces } from "./namespaces";

const charts = {
    metricsServer: { repo: "https://kubernetes-sigs.github.io/metrics-server/", version: "3.13.1" },
    traefik: { repo: "https://traefik.github.io/charts", version: "41.0.2" },
    cloudnativePg: { repo: "https://cloudnative-pg.github.io/charts", version: "0.29.0" },
    tailscale: { repo: "https://pkgs.tailscale.com/helmcharts", version: "1.98.9" },
    infisicalOperator: {
        repo: "https://dl.cloudsmith.io/public/infisical/helm-charts/helm/charts/",
        version: "v0.11.5",
    },
} as const;

export function createPlatform(provider: k8s.Provider, namespaces: Namespaces) {
    const metricsServer = new k8s.helm.v3.Chart("metrics-server", {
        chart: "metrics-server",
        ...charts.metricsServer,
        namespace: namespaces.platform.metadata.name,
        values: {
            replicas: 1,
            resources: {
                requests: { cpu: "50m", memory: "96Mi" },
                limits: { cpu: "150m", memory: "192Mi" },
            },
        },
    }, { provider });

    const traefik = new k8s.helm.v3.Chart("traefik", {
        chart: "traefik",
        ...charts.traefik,
        namespace: namespaces.platform.metadata.name,
        values: {
            deployment: { replicas: 1 },
            service: { type: "ClusterIP" },
            ingressClass: { enabled: true, isDefaultClass: true },
            providers: { kubernetesIngress: { enabled: true } },
            metrics: { prometheus: { enabled: true } },
            resources: {
                requests: { cpu: "100m", memory: "128Mi" },
                limits: { cpu: "300m", memory: "256Mi" },
            },
        },
    }, { provider });

    const cloudnativePg = new k8s.helm.v3.Chart("cloudnative-pg", {
        chart: "cloudnative-pg",
        ...charts.cloudnativePg,
        namespace: namespaces.data.metadata.name,
        values: {
            resources: {
                requests: { cpu: "100m", memory: "128Mi" },
                limits: { cpu: "300m", memory: "256Mi" },
            },
        },
    }, { provider });

    const infisicalOperator = new k8s.helm.v3.Chart("infisical-secrets-operator", {
        chart: "secrets-operator",
        ...charts.infisicalOperator,
        namespace: namespaces.secrets.metadata.name,
    }, { provider });

    let tailscaleOperator: k8s.helm.v3.Chart | undefined;
    if (settings.tailscale.enabled) {
        const credentials = new k8s.core.v1.Secret("tailscale-operator-oauth", {
            metadata: { namespace: namespaces.platform.metadata.name },
            stringData: {
                client_id: required.tailscaleOAuthClientId!,
                client_secret: required.tailscaleOAuthClientSecret!,
            },
        }, { provider });

        tailscaleOperator = new k8s.helm.v3.Chart("tailscale-operator", {
            chart: "tailscale-operator",
            ...charts.tailscale,
            namespace: namespaces.platform.metadata.name,
            values: {
                oauth: {
                    clientId: required.tailscaleOAuthClientId!,
                    clientSecret: required.tailscaleOAuthClientSecret!,
                },
            },
        }, { provider, dependsOn: credentials });
    }

    return { metricsServer, traefik, cloudnativePg, infisicalOperator, tailscaleOperator };
}
