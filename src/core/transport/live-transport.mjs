import { OpenCodeSdkTransport } from "./opencode-sdk-transport.mjs";
import { OpenCodeHttpTransport } from "./opencode-http-transport.mjs";

const REQUIRED_METHODS = ["init", "createSession", "callAgent", "close"];

export function assertLiveTransport(transport) {
  if (!transport || typeof transport !== "object") {
    throw new Error("Live transport must be an object.");
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof transport[method] !== "function") {
      throw new Error(`Live transport is missing required method: ${method}`);
    }
  }

  if (transport.getStatus !== undefined && typeof transport.getStatus !== "function") {
    throw new Error("Live transport getStatus must be a function when provided.");
  }

  return transport;
}

export function createLiveTransport(config) {
  const adapter = config?.adapter || config?.liveTransportAdapter || "sdk";
  if (adapter === "sdk") {
    return assertLiveTransport(new OpenCodeSdkTransport(config));
  }
  if (adapter === "http") {
    return assertLiveTransport(new OpenCodeHttpTransport(config));
  }
  throw new Error(`Unsupported live transport adapter: ${adapter}`);
}
