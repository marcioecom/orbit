import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config("nightmint");

export const nightmintConfig = {
    infisicalProjectSlug: config.require("infisicalProjectSlug"),
    infisicalUniversalAuthClientId: config.requireSecret("infisicalUniversalAuthClientId"),
    infisicalUniversalAuthClientSecret: config.requireSecret("infisicalUniversalAuthClientSecret"),
};
