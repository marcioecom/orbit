import * as k8s from "@pulumi/kubernetes";
import * as cloudflare from "@pulumi/cloudflare";
import { createProjectNamespace } from "../namespace";
import { echoConfig } from "./config";
import { createEchoData } from "./data";
import { createEchoEdge } from "./edge";
import { createEchoSecrets } from "./secrets";
import { createEchoStorage } from "./storage";

export function createEchoProject(
    provider: k8s.Provider,
    dependencies: {
        cloudnativePg: k8s.helm.v3.Release;
        infisicalOperator: k8s.helm.v3.Release;
        backupBucket: cloudflare.R2Bucket;
        tunnel: cloudflare.ZeroTrustTunnelCloudflared | undefined;
    },
) {
    const namespace = createProjectNamespace(provider, "echo");
    const data = createEchoData(provider, namespace, dependencies.cloudnativePg, dependencies.backupBucket);
    const secrets = createEchoSecrets(provider, namespace, dependencies.infisicalOperator);
    const storage = createEchoStorage();
    const edge = createEchoEdge(dependencies.tunnel);

    return {
        namespace,
        ...data,
        ...secrets,
        ...storage,
        ...edge,
        tunnelRoute: {
            hostname: echoConfig.apiHostname,
            service: "http://echo-api.echo.svc.cluster.local:80",
        },
    };
}
