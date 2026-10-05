import * as cloudflare from "@pulumi/cloudflare";
import { settings } from "../../config";
import { echoConfig } from "./config";

export function createEchoEdge(tunnel: cloudflare.ZeroTrustTunnelCloudflared | undefined) {
    if (!tunnel) return { dnsRecord: undefined };

    const dnsRecord = new cloudflare.DnsRecord("echo-api-public-dns", {
        zoneId: settings.cloudflare.zoneId!,
        name: echoConfig.apiHostname,
        type: "CNAME",
        content: tunnel.id.apply((id) => `${id}.cfargotunnel.com`),
        proxied: true,
        ttl: 1,
    }, { dependsOn: [tunnel] });

    return { dnsRecord };
}
