import { settings } from "../config";

export function dataNodeSelector() {
    if (settings.dataNodeSelector === "") return undefined;

    const [key, value] = settings.dataNodeSelector.split("=", 2);
    if (key === undefined || value === undefined || key === "" || value === "") {
        throw new Error("orbit:dataNodeSelector must use the format label=value.");
    }

    return { [key]: value };
}
