import type { GlobalRole } from "../models.js";

/** Multi-tenant auth context attached to a GatewayWsClient connection */
export interface MasAuthContext {
  userId: string | null;
  tenantId: string | null;
  masRole: GlobalRole | null;
  /** Display name resolved from DB at connect time; used to populate SenderName in chat.send */
  displayName?: string;
}

// WeakMap to attach MasAuthContext to any object (GatewayWsClient) without modifying its type
const masAuthMap = new WeakMap<object, MasAuthContext>();

export function setMasAuth(client: object, auth: MasAuthContext): void {
  masAuthMap.set(client, auth);
}

export function getMasAuth(client: object): MasAuthContext | null {
  return masAuthMap.get(client) ?? null;
}

/** Null context for compatibility mode (no masToken) */
export const NULL_MAS_AUTH: MasAuthContext = {
  userId: null,
  tenantId: null,
  masRole: null,
};
