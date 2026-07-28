import * as k8s from "@pulumi/kubernetes";
import type { Namespaces } from "./namespaces";

const charts = {
    prometheus: { repository: "https://prometheus-community.github.io/helm-charts", version: "87.19.1" },
    loki: { repository: "https://grafana.github.io/helm-charts", version: "7.1.0" },
} as const;

export function createObservability(provider: k8s.Provider, namespaces: Namespaces) {
    const monitoring = new k8s.helm.v3.Chart("kube-prometheus-stack", {
        chart: "kube-prometheus-stack",
        version: charts.prometheus.version,
        fetchOpts: { repo: charts.prometheus.repository },
        namespace: namespaces.observability.metadata.name,
        values: {
            grafana: {
                persistence: {
                    enabled: true,
                    storageClassName: "hcloud-volumes",
                    size: "2Gi",
                },
                resources: {
                    requests: { cpu: "100m", memory: "256Mi" },
                    limits: { cpu: "300m", memory: "512Mi" },
                },
            },
            prometheus: {
                prometheusSpec: {
                    retention: "7d",
                    resources: {
                        requests: { cpu: "300m", memory: "768Mi" },
                        limits: { cpu: "700m", memory: "1536Mi" },
                    },
                    storageSpec: {
                        volumeClaimTemplate: {
                            spec: {
                                storageClassName: "hcloud-volumes",
                                accessModes: ["ReadWriteOnce"],
                                resources: { requests: { storage: "10Gi" } },
                            },
                        },
                    },
                },
            },
            alertmanager: {
                alertmanagerSpec: {
                    resources: {
                        requests: { cpu: "50m", memory: "128Mi" },
                        limits: { cpu: "150m", memory: "256Mi" },
                    },
                },
            },
        },
    }, { provider });

    const loki = new k8s.helm.v3.Chart("loki", {
        chart: "loki",
        version: charts.loki.version,
        fetchOpts: { repo: charts.loki.repository },
        namespace: namespaces.observability.metadata.name,
        values: {
            deploymentMode: "SingleBinary",
            loki: {
                auth_enabled: false,
                commonConfig: { replication_factor: 1 },
                schemaConfig: {
                    configs: [{
                        from: "2026-07-01",
                        store: "tsdb",
                        object_store: "filesystem",
                        schema: "v13",
                        index: { prefix: "index_", period: "24h" },
                    }],
                },
                storage: { type: "filesystem" },
            },
            chunksCache: { enabled: false },
            resultsCache: { enabled: false },
            lokiCanary: { enabled: false },
            test: { enabled: false },
            singleBinary: {
                replicas: 1,
                persistence: {
                    enabled: true,
                    storageClass: "hcloud-volumes",
                    size: "10Gi",
                },
                resources: {
                    requests: { cpu: "150m", memory: "256Mi" },
                    limits: { cpu: "400m", memory: "512Mi" },
                },
            },
            read: { replicas: 0 },
            write: { replicas: 0 },
            backend: { replicas: 0 },
        },
    }, { provider });

    const alloyConfig = new k8s.core.v1.ConfigMap("alloy-config", {
        metadata: { namespace: namespaces.observability.metadata.name },
        data: {
            "config.alloy": `
local.file_match "pods" {
  path_targets = [{ __path__ = "/var/log/pods/*/*/*.log" }]
}

loki.source.file "pods" {
  targets    = local.file_match.pods.targets
  forward_to = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "http://loki-gateway.observability.svc.cluster.local/loki/api/v1/push"
  }
}
`,
        },
    }, { provider });

    const alloy = new k8s.apps.v1.DaemonSet("alloy", {
        metadata: {
            namespace: namespaces.observability.metadata.name,
            labels: { "app.kubernetes.io/name": "alloy" },
        },
        spec: {
            selector: { matchLabels: { "app.kubernetes.io/name": "alloy" } },
            template: {
                metadata: { labels: { "app.kubernetes.io/name": "alloy" } },
                spec: {
                    tolerations: [{ operator: "Exists" }],
                    containers: [{
                        name: "alloy",
                        image: "grafana/alloy:v1.18.0",
                        args: ["run", "/etc/alloy/config.alloy", "--server.http.listen-addr=0.0.0.0:12345"],
                        resources: {
                            requests: { cpu: "50m", memory: "128Mi" },
                            limits: { cpu: "200m", memory: "256Mi" },
                        },
                        volumeMounts: [
                            { name: "config", mountPath: "/etc/alloy" },
                            { name: "pods", mountPath: "/var/log/pods", readOnly: true },
                        ],
                    }],
                    volumes: [
                        { name: "config", configMap: { name: alloyConfig.metadata.name } },
                        { name: "pods", hostPath: { path: "/var/log/pods" } },
                    ],
                },
            },
        },
    }, { provider, dependsOn: [loki, alloyConfig] });

    return {
        monitoring,
        loki,
        alloy,
        grafanaService: "kube-prometheus-stack-grafana.observability.svc.cluster.local",
    };
}
