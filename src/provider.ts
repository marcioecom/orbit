import * as k8s from "@pulumi/kubernetes";
import { settings } from "./config";

export const kubernetesProvider = new k8s.Provider("orbit-eu", settings.kubeconfig === undefined ? {} : {
    kubeconfig: settings.kubeconfig,
});
