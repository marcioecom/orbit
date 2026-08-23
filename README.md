# Orbit

Infrastructure as code for the shared `orbit-eu` platform. This project manages
Kubernetes add-ons and Cloudflare R2 after `hetzner-k3s` has bootstrapped the
existing Hetzner VMs.

`k3s/cluster-orbit-eu.yaml` remains the source of truth for VM adoption, k3s,
private networking, and Tailscale installation. Pulumi must not shell out to
`hetzner-k3s`; the bootstrap and the in-cluster platform are separate lifecycle
boundaries.

The cluster file is a public template. It has no administrative IP or absolute
project path. Run `hetzner-k3s` through `k3s/hetzner-k3s.sh`, which substitutes
`ADMIN_CIDR` into a temporary configuration file and removes it on exit. The
generated kubeconfig remains ignored by Git.

```sh
export ADMIN_CIDR="$(curl -fsS https://api.ipify.org)/32"
./k3s/hetzner-k3s.sh create
```

## Scope

The first stack installs:

- private Traefik ingress and metrics-server;
- Tailscale Kubernetes Operator, used only to expose Infisical inside the tailnet;
- Cloudflare R2 bucket for database backups and optional `cloudflared` replicas;
- CloudNativePG and a single-instance Postgres cluster for Echo;
- Valkey for Echo BullMQ queues;
- self-hosted Infisical with its own CNPG database and private Tailscale ingress;
- Infisical Secrets Operator, plus the echo secret sync (`InfisicalSecret` CRs
  replicating the `/shared`, `/api`, and `/worker` Infisical folders into the
  `echo` namespace) and the shared GHCR pull credential;
- Prometheus, Grafana, Alertmanager, Loki, and Grafana Alloy.

The cluster has one control plane and only two schedulable workers. Every
stateful service therefore starts as a single instance with Hetzner volumes and
external backup. This is not a highly available data plane. A worker or volume
location failure requires recovery, not automatic failover.

## Before The First Apply

1. Confirm all nodes are `Ready` and the API is reachable only through Tailscale.
2. Verify the host keys and measure private RTT between Nuremberg, Falkenstein,
   and Helsinki. Set `dataNodeSelector` to the chosen primary data location.
3. Create a least-privilege Cloudflare API token with R2, DNS, and Zero Trust
   Tunnel permissions, and export it as `CLOUDFLARE_API_TOKEN` in the local
   shell or CI environment.
4. Create an R2 S3 access key limited to the backup bucket.
5. Create a tagged Tailscale OAuth client for the Kubernetes Operator. Its ACL
   tag must be allowed to create the private Infisical proxy.
6. Enable HTTPS in the tailnet before creating the Infisical ingress.

## Stack Setup

Create the stack and use `Pulumi.example.yaml` as a non-secret reference:

```sh
pulumi stack init orbit-eu
pulumi config set cloudflareAccountId <account-id>
pulumi config set backupBucketName orbit-eu-backups
pulumi config set dataNodeSelector topology.kubernetes.io/region=<chosen-region>
pulumi config set infisicalSiteUrl https://infisical.<your-tailnet>.ts.net
pulumi config set --secret backupAccessKeyId <r2-access-key-id>
pulumi config set --secret backupSecretAccessKey <r2-secret-access-key>
pulumi config set --secret echoPostgresPassword <generated-password>
pulumi config set --secret echoValkeyPassword <generated-password>
pulumi config set --secret echoInfisicalUniversalAuthClientId <machine-identity-client-id>
pulumi config set --secret echoInfisicalUniversalAuthClientSecret <machine-identity-client-secret>
pulumi config set ghcrUsername <github-username>
pulumi config set --secret ghcrPullToken <github-pat-with-read-packages>
pulumi config set --secret infisicalEncryptionKey <16-byte-hex-key>
pulumi config set --secret infisicalAuthSecret <generated-secret>
pulumi config set --secret infisicalPostgresPassword <generated-password>
pulumi config set --secret infisicalRedisPassword <generated-password>
pulumi config set infisicalSmtpFromAddress <verified-resend-sender-address>
pulumi config set infisicalSmtpFromName Infisical
pulumi config set --secret infisicalResendApiKey <resend-api-key>
pulumi config set --secret grafanaAdminPassword <generated-password>
pulumi config set --secret tailscaleOAuthClientId <oauth-client-id>
pulumi config set --secret tailscaleOAuthClientSecret <oauth-client-secret>
```

For local runs, set `KUBECONFIG` to `k3s/kubeconfig-orbit-eu` instead of putting
the kubeconfig in Pulumi state. For CI, inject the raw kubeconfig through the
runner's secret store. Do not commit kubeconfigs.

The echo machine identity is the one input that cannot be provisioned by
Pulumi: create it in the Infisical UI (Organization Settings > Machine
Identities, Universal Auth), grant it read access to the `echo` project `prod`
environment, and copy the client ID and secret into the config values above.
The identity, project folders (`/shared`, `/api`, `/worker`), and secret
values live in Infisical; everything that lands in the cluster is declared in
`src/echo.ts`.

The GHCR pull credential is shared across projects but Kubernetes
`imagePullSecrets` are namespace-scoped, so every project namespace needs its
own copy. New project modules get one by calling `createGhcrPullSecret` from
`src/ghcr.ts` with their namespace; the credential itself stays in the single
`ghcrUsername`/`ghcrPullToken` config pair.

Enable public Echo access through the Cloudflare Tunnel:

```sh
pulumi config set cloudflaredEnabled true
pulumi config set cloudflareZoneId <cloudflare-zone-id>
pulumi config set echoApiHostname echo-api.<cloudflare-zone-name>
```

Pulumi creates the remotely managed Tunnel, retrieves the connector token,
configures the Echo hostname to reach the `echo-api` ClusterIP Service, and
creates the Cloudflare CNAME record. The Echo deployment does not need a
Kubernetes Ingress for this route. Do not put Cloudflare Access in front of
Twilio webhooks; enforce Twilio signature verification in `apps/api` instead.

## Apply And Verify

```sh
pnpm typecheck
pnpm preview
pnpm up
kubectl --kubeconfig k3s/kubeconfig-orbit-eu get pods -A
kubectl --kubeconfig k3s/kubeconfig-orbit-eu get cluster -n echo
kubectl --kubeconfig k3s/kubeconfig-orbit-eu get scheduledbackup -A
```

Before deploying Echo, verify each of these paths:

- Grafana is reachable through the chosen administrative path.
- Infisical is reachable only over the Tailnet ingress.
- CNPG reports a healthy primary and can create a backup in R2.
- A restore into an isolated namespace succeeds.
- Valkey authentication works from the Echo namespace.
- Each `InfisicalSecret` in the echo namespace reports a successful sync and
  the managed secrets `echo-shared-secrets`, `echo-api-secrets`, and
  `echo-worker-secrets` exist.
- Loki receives a test log line.
- Alertmanager delivers a test alert to a configured receiver.

## Backup Note

The initial CNPG cluster uses the native `barmanObjectStore` configuration for
R2 compatibility. CloudNativePG 1.30 still supports it, but marks it as
deprecated in favor of the Barman Cloud CNPG-I plugin. Introduce that plugin
before the native path is removed, and keep a restore test as the acceptance
criterion for every backup change.

The k3s local etcd snapshots are not sufficient for disaster recovery. Add an
external etcd snapshot upload to R2 in the `hetzner-k3s` bootstrap layer before
declaring the control plane recoverable.
