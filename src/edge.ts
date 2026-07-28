import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import { required, settings } from "./config";
import type { Namespaces } from "./namespaces";

export function createEdge(
    provider: k8s.Provider,
    namespaces: Namespaces,
    traefik: k8s.helm.v3.Chart,
) {
    const backupBucket = new cloudflare.R2Bucket("backups", {
        accountId: required.cloudflareAccountId,
        name: settings.cloudflare.backupBucketName,
        jurisdiction: "eu",
        location: "weur",
    });

    const backupCredentials = (name: string, namespace: k8s.core.v1.Namespace) => new k8s.core.v1.Secret(name, {
        metadata: { namespace: namespace.metadata.name },
        stringData: {
            ACCESS_KEY_ID: required.backupAccessKeyId,
            SECRET_ACCESS_KEY: required.backupSecretAccessKey,
            BUCKET_NAME: backupBucket.name,
            ENDPOINT: `https://${required.cloudflareAccountId}.eu.r2.cloudflarestorage.com`,
        },
    }, { provider });

    const dataBackupCredentials = backupCredentials("r2-data-backup-credentials", namespaces.data);
    const echoBackupCredentials = backupCredentials("r2-echo-backup-credentials", namespaces.echo);

    let cloudflared: k8s.apps.v1.Deployment | undefined;
    let tunnel: cloudflare.ZeroTrustTunnelCloudflared | undefined;
    if (settings.cloudflared.enabled) {
        tunnel = new cloudflare.ZeroTrustTunnelCloudflared("orbit-eu-tunnel", {
            accountId: required.cloudflareAccountId,
            name: `${settings.clusterName}-tunnel`,
            configSrc: "cloudflare",
        });
        const tunnelToken = cloudflare.getZeroTrustTunnelCloudflaredTokenOutput({
            accountId: required.cloudflareAccountId,
            tunnelId: tunnel.id,
        });

        const tunnelTokenSecret = new k8s.core.v1.Secret("cloudflared-tunnel-token", {
            metadata: { namespace: namespaces.edge.metadata.name },
            stringData: { token: tunnelToken.apply((value) => value.token) },
        }, { provider });

        cloudflared = new k8s.apps.v1.Deployment("cloudflared", {
            metadata: {
                namespace: namespaces.edge.metadata.name,
                labels: { "app.kubernetes.io/name": "cloudflared" },
            },
            spec: {
                replicas: 2,
                selector: { matchLabels: { "app.kubernetes.io/name": "cloudflared" } },
                template: {
                    metadata: { labels: { "app.kubernetes.io/name": "cloudflared" } },
                    spec: {
                        affinity: {
                            podAntiAffinity: {
                                preferredDuringSchedulingIgnoredDuringExecution: [{
                                    weight: 100,
                                    podAffinityTerm: {
                                        topologyKey: "kubernetes.io/hostname",
                                        labelSelector: {
                                            matchLabels: { "app.kubernetes.io/name": "cloudflared" },
                                        },
                                    },
                                }],
                            },
                        },
                        containers: [{
                            name: "cloudflared",
                            image: "cloudflare/cloudflared:2025.6.0",
                            args: ["tunnel", "--no-autoupdate", "--metrics", "0.0.0.0:2000", "run"],
                            env: [{
                                name: "TUNNEL_TOKEN",
                                valueFrom: {
                                    secretKeyRef: { name: tunnelTokenSecret.metadata.name, key: "token" },
                                },
                            }],
                            ports: [{ name: "metrics", containerPort: 2000 }],
                            livenessProbe: {
                                httpGet: { path: "/ready", port: "metrics" },
                                initialDelaySeconds: 10,
                                periodSeconds: 10,
                            },
                            readinessProbe: {
                                httpGet: { path: "/ready", port: "metrics" },
                                initialDelaySeconds: 5,
                                periodSeconds: 10,
                            },
                            resources: {
                                requests: { cpu: "50m", memory: "64Mi" },
                                limits: { cpu: "150m", memory: "128Mi" },
                            },
                            securityContext: {
                                allowPrivilegeEscalation: false,
                                capabilities: { drop: ["ALL"] },
                                readOnlyRootFilesystem: true,
                                runAsNonRoot: true,
                            },
                        }],
                    },
                },
            },
        }, { provider, dependsOn: [traefik, tunnelTokenSecret] });
    }

    return { backupBucket, dataBackupCredentials, echoBackupCredentials, cloudflared, tunnel };
}
