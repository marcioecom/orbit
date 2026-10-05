import * as pulumi from "@pulumi/pulumi";
import { settings } from "./src/config";
import { configureTunnelRoutes, createEdge } from "./src/edge";
import { createInfisical } from "./src/infisical";
import { createNamespaces } from "./src/namespaces";
import { createObservability } from "./src/observability";
import { kubernetesProvider } from "./src/provider";
import { createPlatform } from "./src/platform";
import { createNightmintProject } from "./src/projects/nightmint";
import { createEchoProject } from "./src/projects/echo";

const namespaces = createNamespaces(kubernetesProvider);
const platform = createPlatform(kubernetesProvider, namespaces);
const edge = createEdge(kubernetesProvider, namespaces, platform.traefik);
const infisical = createInfisical(kubernetesProvider, namespaces, platform.cloudnativePg);
const echo = createEchoProject(kubernetesProvider, {
    cloudnativePg: platform.cloudnativePg,
    infisicalOperator: platform.infisicalOperator,
    backupBucket: edge.backupBucket,
    tunnel: edge.tunnel,
});
const observability = createObservability(kubernetesProvider, namespaces);
configureTunnelRoutes(edge.tunnel, [echo.tunnelRoute]);
const nightmint = createNightmintProject(kubernetesProvider, {
    cloudnativePg: platform.cloudnativePg,
    infisicalOperator: platform.infisicalOperator,
    backupBucket: edge.backupBucket,
});

export const clusterName = settings.clusterName;
export const namespaceNames = pulumi.all(
    [...Object.values(namespaces), echo.namespace, nightmint.namespace].map((namespace) => namespace.metadata.name),
);
export const echoManagedSecretNames = pulumi.all(echo.secretSyncs.map((sync) => sync.metadata.name));
export const nightmintManagedSecretNames = pulumi.all(nightmint.secretSyncs.map((sync) => sync.metadata.name));
export const echoPostgresService = echo.echoPostgresService;
export const echoValkeyService = echo.echoValkeyService;
export const grafanaService = observability.grafanaService;
export const infisicalTailnetIngress = infisical.tailnetIngress.metadata.name;
