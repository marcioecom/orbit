import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config("echo");

export const echoConfig = {
  infisicalProjectSlug: config.require("infisicalProjectSlug"),
  infisicalUniversalAuthClientId: config.requireSecret(
    "infisicalUniversalAuthClientId",
  ),
  infisicalUniversalAuthClientSecret: config.requireSecret(
    "infisicalUniversalAuthClientSecret",
  ),
  postgresPassword: config.requireSecret("postgresPassword"),
  valkeyPassword: config.requireSecret("valkeyPassword"),
  apiHostname: config.require("apiHostname"),
  webOrigin: config.require("webOrigin"),
  storageBucketName: config.get("storageBucketName") ?? "echo-storage",
};
