import { TenantServiceError } from "../errors.js";
import type { TenantService } from "../index.js";
import { strCoerce, errorShape, type SimpleHandlers } from "./aiemas-utils.js";

export interface AuthPluginHandlersDeps {
  tenantService: TenantService;
}

export function registerAuthPluginHandlers(
  handlers: SimpleHandlers,
  deps: AuthPluginHandlersDeps,
): void {
  const { tenantService } = deps;

  handlers["auth.login"] = async ({ params, client, respond }) => {
    try {
      const c = client as {
        remoteAddress?: string;
        socket?: { _socket?: { remoteAddress?: string } };
        _socket?: { remoteAddress?: string };
      };
      const clientIp =
        c?.remoteAddress || c?.socket?._socket?.remoteAddress || c?._socket?.remoteAddress;

      const loginParams = params as Parameters<TenantService["login"]>[0];
      if (clientIp) {
        loginParams.clientIp = clientIp;
      }

      const result = tenantService.login(loginParams);
      if (result.ok) {
        respond(true, result, undefined);
      } else {
        respond(false, undefined, errorShape(result.error, result.error));
      }
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  handlers["auth.refresh"] = async ({ params, respond }) => {
    try {
      const token = strCoerce(params["token"]);
      const result = tenantService.refresh(token);
      if (result.ok) {
        respond(true, result, undefined);
      } else {
        respond(false, undefined, errorShape(result.error, result.error));
      }
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  handlers["auth.verify"] = async ({ params, respond }) => {
    try {
      const token = strCoerce(params["token"]);
      const result = tenantService.verify(token);
      if (result.ok) {
        respond(true, result, undefined);
      } else {
        respond(false, undefined, errorShape(result.error, result.error));
      }
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };
}
