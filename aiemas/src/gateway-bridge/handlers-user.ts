import { TenantServiceError } from "../errors.js";
import type { TenantService } from "../index.js";
import { strCoerce, errorShape, getCallerAuth, type SimpleHandlers } from "./aiemas-utils.js";
import type { GatewayAuthBridge } from "./bridge.js";

export interface UserHandlersDeps {
  tenantService: TenantService;
  bridge: GatewayAuthBridge;
}

export function registerUserHandlers(handlers: SimpleHandlers, deps: UserHandlersDeps): void {
  const { tenantService, bridge } = deps;

  handlers["user.register"] = async ({ params, client, respond }) => {
    const auth = getCallerAuth(client);
    try {
      const result = tenantService.registerUser(
        params as unknown as Parameters<TenantService["registerUser"]>[0],
        auth.masRole ?? undefined,
      );
      respond(true, result, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  handlers["user.list"] = async ({ params, client, respond }) => {
    const auth = getCallerAuth(client);
    try {
      const tenantId = strCoerce(params["tenantId"] ?? auth.tenantId ?? "");
      const callerRole = auth.masRole;
      if (!callerRole) {
        respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
        return;
      }
      const result = tenantService.listUsers(tenantId, callerRole);
      respond(true, result, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  handlers["user.update"] = async ({ params, client, respond }) => {
    const auth = getCallerAuth(client);
    try {
      const callerRole = auth.masRole;
      if (!callerRole) {
        respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
        return;
      }
      const result = tenantService.updateUser(
        params as unknown as Parameters<TenantService["updateUser"]>[0],
        callerRole,
      );
      respond(true, result, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  handlers["user.approve"] = async ({ params, client, respond }) => {
    const auth = getCallerAuth(client);
    try {
      const callerRole = auth.masRole;
      if (!callerRole) {
        respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
        return;
      }
      tenantService.approveUser(strCoerce(params["targetUserId"]), callerRole);
      respond(true, { ok: true }, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  handlers["user.reject"] = async ({ params, client, respond }) => {
    const auth = getCallerAuth(client);
    try {
      const callerRole = auth.masRole;
      if (!callerRole) {
        respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
        return;
      }
      tenantService.rejectUser(strCoerce(params["targetUserId"]), callerRole);
      respond(true, { ok: true }, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  handlers["user.logout"] = async ({ client, respond }) => {
    const auth = getCallerAuth(client);
    try {
      console.log(`[mas4s:plugin] user.logout userId=${auth.userId ?? "null"}`);
      if (auth.userId) {
        bridge.logout(auth.userId);
      }
      respond(true, { ok: true }, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };
}
