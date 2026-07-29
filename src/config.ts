import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

function requireSecretWhenEnabled(
    enabled: boolean,
    value: pulumi.Output<string> | undefined,
    name: string,
) {
    if (enabled && value === undefined) {
        throw new Error(`Set the secret configuration value orbit:${name} before enabling this component.`);
    }

    return value;
}

export const settings = {
    clusterName: config.get("clusterName") ?? "orbit-eu",
    kubeconfig: config.getSecret("kubeconfig"),
    storageClassName: config.get("storageClassName") ?? "hcloud-volumes",
    dataNodeSelector: config.get("dataNodeSelector") ?? "",
    cloudflare: {
        accountId: config.get("cloudflareAccountId"),
        backupBucketName: config.get("backupBucketName") ?? "orbit-eu-backups",
        backupAccessKeyId: config.getSecret("backupAccessKeyId"),
        backupSecretAccessKey: config.getSecret("backupSecretAccessKey"),
    },
    cloudflared: {
        enabled: config.getBoolean("cloudflaredEnabled") ?? false,
    },
    tailscale: {
        enabled: config.getBoolean("tailscaleOperatorEnabled") ?? true,
        oauthClientId: config.getSecret("tailscaleOAuthClientId"),
        oauthClientSecret: config.getSecret("tailscaleOAuthClientSecret"),
    },
    echo: {
        postgresPassword: config.getSecret("echoPostgresPassword"),
        valkeyPassword: config.getSecret("echoValkeyPassword"),
        infisicalUniversalAuthClientId: config.getSecret("echoInfisicalUniversalAuthClientId"),
        infisicalUniversalAuthClientSecret: config.getSecret("echoInfisicalUniversalAuthClientSecret"),
    },
    ghcr: {
        username: config.get("ghcrUsername"),
        pullToken: config.getSecret("ghcrPullToken"),
    },
    infisical: {
        siteUrl: config.get("infisicalSiteUrl"),
        encryptionKey: config.getSecret("infisicalEncryptionKey"),
        authSecret: config.getSecret("infisicalAuthSecret"),
        postgresPassword: config.getSecret("infisicalPostgresPassword"),
        redisPassword: config.getSecret("infisicalRedisPassword"),
        resendApiKey: config.getSecret("infisicalResendApiKey"),
        smtpFromAddress: config.get("infisicalSmtpFromAddress"),
        smtpFromName: config.get("infisicalSmtpFromName") ?? "Infisical",
    },
    observability: {
        grafanaAdminPassword: config.getSecret("grafanaAdminPassword"),
    },
};

export const secrets = {
    tailscaleOAuthClientId: requireSecretWhenEnabled(
        settings.tailscale.enabled,
        settings.tailscale.oauthClientId,
        "tailscaleOAuthClientId",
    ),
    tailscaleOAuthClientSecret: requireSecretWhenEnabled(
        settings.tailscale.enabled,
        settings.tailscale.oauthClientSecret,
        "tailscaleOAuthClientSecret",
    ),
};

if (!settings.tailscale.enabled) {
    throw new Error("tailscaleOperatorEnabled must remain true while Infisical uses a tailnet-only ingress.");
}

if (settings.echo.postgresPassword === undefined || settings.echo.valkeyPassword === undefined) {
    throw new Error(
        "Set the secret configuration values orbit:echoPostgresPassword and orbit:echoValkeyPassword before deploying data services.",
    );
}

if (
    settings.infisical.siteUrl === undefined ||
    settings.infisical.encryptionKey === undefined ||
    settings.infisical.authSecret === undefined ||
    settings.infisical.postgresPassword === undefined ||
    settings.infisical.redisPassword === undefined
) {
    throw new Error(
        "Set orbit:infisicalSiteUrl and the Infisical secret configuration values before deploying secrets management.",
    );
}

if (settings.observability.grafanaAdminPassword === undefined) {
    throw new Error("Set the secret configuration value orbit:grafanaAdminPassword before deploying observability.");
}

if (
    settings.cloudflare.accountId === undefined ||
    settings.cloudflare.backupAccessKeyId === undefined ||
    settings.cloudflare.backupSecretAccessKey === undefined
) {
    throw new Error(
        "Set orbit:cloudflareAccountId and the secret backup access keys before deploying backups.",
    );
}

if (
    settings.echo.infisicalUniversalAuthClientId === undefined ||
    settings.echo.infisicalUniversalAuthClientSecret === undefined
) {
    throw new Error(
        "Set the secret configuration values orbit:echoInfisicalUniversalAuthClientId and orbit:echoInfisicalUniversalAuthClientSecret before deploying echo secret sync.",
    );
}

if (settings.ghcr.username === undefined || settings.ghcr.pullToken === undefined) {
    throw new Error(
        "Set orbit:ghcrUsername and the secret configuration value orbit:ghcrPullToken before deploying image pull credentials.",
    );
}

// The checks above keep the rest of the resource graph free from optional inputs.
export const required = {
    cloudflareAccountId: settings.cloudflare.accountId!,
    backupAccessKeyId: settings.cloudflare.backupAccessKeyId!,
    backupSecretAccessKey: settings.cloudflare.backupSecretAccessKey!,
    echoPostgresPassword: settings.echo.postgresPassword!,
    echoValkeyPassword: settings.echo.valkeyPassword!,
    echoInfisicalUniversalAuthClientId: settings.echo.infisicalUniversalAuthClientId!,
    echoInfisicalUniversalAuthClientSecret: settings.echo.infisicalUniversalAuthClientSecret!,
    ghcrUsername: settings.ghcr.username!,
    ghcrPullToken: settings.ghcr.pullToken!,
    infisicalEncryptionKey: settings.infisical.encryptionKey!,
    infisicalSiteUrl: settings.infisical.siteUrl!,
    infisicalAuthSecret: settings.infisical.authSecret!,
    infisicalPostgresPassword: settings.infisical.postgresPassword!,
    infisicalRedisPassword: settings.infisical.redisPassword!,
    grafanaAdminPassword: settings.observability.grafanaAdminPassword!,
    tailscaleOAuthClientId: secrets.tailscaleOAuthClientId,
    tailscaleOAuthClientSecret: secrets.tailscaleOAuthClientSecret,
};
