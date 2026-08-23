import * as pulumi from "@pulumi/pulumi";
import { settings } from "./src/config";
import { createDataServices } from "./src/data";
import { createEchoSecrets } from "./src/echo";
import { createEdge } from "./src/edge";
import { createInfisical } from "./src/infisical";
import { createNamespaces } from "./src/namespaces";
import { createObservability } from "./src/observability";
import { kubernetesProvider } from "./src/provider";
import { createPlatform } from "./src/platform";
import { createNightmintProject } from "./src/projects/nightmint";

const namespaces = createNamespaces(kubernetesProvider);
const platform = createPlatform(kubernetesProvider, namespaces);
const edge = createEdge(kubernetesProvider, namespaces, platform.traefik);
const infisical = createInfisical(kubernetesProvider, namespaces, platform.cloudnativePg);
const data = createDataServices(
    kubernetesProvider,
    namespaces,
    platform.cloudnativePg,
    edge.echoBackupCredentials,
);
const observability = createObservability(kubernetesProvider, namespaces);
const echoSecrets = createEchoSecrets(kubernetesProvider, namespaces, platform.infisicalOperator);
const nightmint = createNightmintProject(
    kubernetesProvider,
    platform.cloudnativePg,
    platform.infisicalOperator,
);

export const clusterName = settings.clusterName;
export const namespaceNames = pulumi.all(
    [...Object.values(namespaces), nightmint.namespace].map((namespace) => namespace.metadata.name),
);
export const echoManagedSecretNames = pulumi.all(echoSecrets.secretSyncs.map((sync) => sync.metadata.name));
export const echoPostgresService = data.echoPostgresService;
export const echoValkeyService = data.echoValkeyService;
export const grafanaService = observability.grafanaService;
export const infisicalTailnetIngress = infisical.tailnetIngress.metadata.name;
