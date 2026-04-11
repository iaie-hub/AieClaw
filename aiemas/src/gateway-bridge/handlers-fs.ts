import { TenantServiceError } from "../errors.js";
import { strCoerce, errorShape, type SimpleHandlers } from "./aiemas-utils.js";
import type { Mas4sGatewayPlugin } from "./mas4s-gateway-plugin.js";

export interface FsHandlersDeps {
  sessionStore: ReturnType<
    typeof import("../store/aiemas-sessions-store.js").createAiemasSessionsStore
  >;
  /** Lazy reference to the plugin object (set after plugin is constructed). */
  getPlugin: () => Mas4sGatewayPlugin;
}

export function registerFsHandlers(handlers: SimpleHandlers, deps: FsHandlersDeps): void {
  const { sessionStore, getPlugin } = deps;

  // ── aiemas.agents.preDelete ──
  handlers["aiemas.agents.preDelete"] = async ({ params, respond }) => {
    try {
      const agentId = strCoerce(params["agentId"]);
      if (!agentId) {
        respond(false, undefined, errorShape("INVALID_PARAMS", "agentId required"));
        return;
      }
      const count = sessionStore.countByCurrentAgentId(agentId);
      if (count === 0) {
        respond(true, { ok: true }, undefined);
      } else {
        respond(
          false,
          undefined,
          errorShape("AGENT_IN_USE", `该智能体仍有 ${count} 个关联会话，无法删除`),
        );
      }
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  // ── aiemas.fs.list ──
  handlers["aiemas.fs.list"] = async ({ params, respond }) => {
    try {
      const dirPath = strCoerce(params["dirPath"]);
      if (!dirPath) {
        respond(false, undefined, errorShape("INVALID_PARAMS", "dirPath required"));
        return;
      }
      const { readdir, stat } = await import("node:fs/promises");
      const nodePath = await import("node:path");
      let dirents;
      try {
        dirents = await readdir(dirPath, { withFileTypes: true });
      } catch (fsErr) {
        if ((fsErr as NodeJS.ErrnoException).code === "ENOENT") {
          respond(false, undefined, errorShape("NOT_FOUND", "目录不存在"));
          return;
        }
        throw fsErr;
      }
      const entries = await Promise.all(
        dirents.map(async (entry) => {
          const size = entry.isDirectory()
            ? 0
            : (await stat(nodePath.join(dirPath, entry.name))).size;
          return {
            name: entry.name,
            type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
            size,
          };
        }),
      );
      respond(true, { entries }, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  // ── aiemas.agents.export ──
  handlers["aiemas.agents.export"] = async ({ params, respond }) => {
    try {
      const agentId = strCoerce(params["agentId"]);
      const workspace = strCoerce(params["workspace"]);
      const items = params["items"];
      if (!agentId || !workspace || !Array.isArray(items)) {
        respond(
          false,
          undefined,
          errorShape("INVALID_PARAMS", "agentId, workspace, items required"),
        );
        return;
      }
      const nodePath = await import("node:path");
      const { access: fsAccess, cp, rm } = await import("node:fs/promises");
      const { mkdirSync } = await import("node:fs");
      const { promisify } = await import("node:util");
      const { execFile } = await import("node:child_process");
      const execFileAsync = promisify(execFile);

      try {
        await fsAccess(workspace);
      } catch {
        respond(false, undefined, errorShape("NOT_FOUND", "工作区目录不存在"));
        return;
      }

      const tempDir = nodePath.join(nodePath.dirname(workspace), `${agentId}-export`);
      const archivePath = nodePath.join(nodePath.dirname(workspace), `${agentId}-export.zip`);

      mkdirSync(tempDir, { recursive: true });
      try {
        for (const item of items as string[]) {
          const src = nodePath.join(workspace, item);
          const dest = nodePath.join(tempDir, item);
          await cp(src, dest, { recursive: true });
        }

        // Remove any pre-existing archive for a clean full export
        await rm(archivePath, { force: true });
        await execFileAsync("zip", ["-r", archivePath, "."], { cwd: tempDir });
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }

      respond(true, { archivePath }, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  // ── aiemas.files.download ──
  handlers["aiemas.files.download"] = async ({ params, respond }) => {
    try {
      const filePath = strCoerce(params["filePath"]);
      if (!filePath) {
        respond(false, undefined, errorShape("INVALID_PARAMS", "filePath required"));
        return;
      }
      const { readFile } = await import("node:fs/promises");
      const nodePath = await import("node:path");
      let content: Buffer;
      try {
        content = await readFile(filePath);
      } catch (fsErr) {
        if ((fsErr as NodeJS.ErrnoException).code === "ENOENT") {
          respond(false, undefined, errorShape("NOT_FOUND", "文件不存在"));
          return;
        }
        throw fsErr;
      }
      respond(
        true,
        {
          data: content.toString("base64"),
          fileName: nodePath.basename(filePath),
          mimeType: "application/octet-stream",
        },
        undefined,
      );
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  // ── aiemas.file.upload ──
  handlers["aiemas.file.upload"] = async ({ params, respond }) => {
    try {
      const fileName = strCoerce(params["fileName"]);
      const data = strCoerce(params["data"]);
      if (!fileName || !data) {
        respond(false, undefined, errorShape("INVALID_PARAMS", "fileName and data required"));
        return;
      }
      const nodePath = await import("node:path");
      const nodeOs = await import("node:os");
      const { mkdirSync } = await import("node:fs");
      const { writeFile } = await import("node:fs/promises");

      const randomId = Math.random().toString(36).slice(2);
      const uploadDir = nodePath.join(nodeOs.tmpdir(), `aiemas-upload-${randomId}`);
      mkdirSync(uploadDir, { recursive: true });
      const filePath = nodePath.join(uploadDir, fileName);
      await writeFile(filePath, Buffer.from(data, "base64"));
      respond(true, { filePath }, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  // ── aiemas.agents.import ──
  handlers["aiemas.agents.import"] = async ({ params, client, respond, dispatchGateway }) => {
    try {
      const archivePath = strCoerce(params["archivePath"]);
      if (!archivePath) {
        respond(
          false,
          undefined,
          errorShape("INVALID_PARAMS", "archivePath required or file not found"),
        );
        return;
      }
      const { access: fsAccess, rm } = await import("node:fs/promises");
      const nodePath = await import("node:path");
      const { promisify } = await import("node:util");
      const { execFile } = await import("node:child_process");
      const execFileAsync = promisify(execFile);

      try {
        await fsAccess(archivePath);
      } catch {
        respond(
          false,
          undefined,
          errorShape("INVALID_PARAMS", "archivePath required or file not found"),
        );
        return;
      }

      const nodeOs = await import("node:os");
      const derivedId = nodePath.basename(archivePath, ".zip");
      const agentId = strCoerce(params["agentId"]) || derivedId;
      const agentName = agentId;
      const workspace =
        strCoerce(params["workspace"]) ||
        nodePath.join(nodeOs.homedir(), `.openclaw`, `workspace-${agentId}`);
      const plugin = getPlugin();
      const dispatch = dispatchGateway ?? plugin.gatewayDispatch;
      if (!dispatch) {
        throw new Error("Gateway dispatch not available");
      }
      const agentCreateResult = (await dispatch(
        "agents.create",
        { name: agentName, workspace },
        client,
      )) as { workspace: string; id: string; [key: string]: unknown };

      const resolvedWorkspace = agentCreateResult.workspace || workspace;
      const uploadDir = nodePath.dirname(archivePath);

      try {
        await execFileAsync("unzip", ["-o", archivePath, "-d", resolvedWorkspace]);
        respond(true, agentCreateResult, undefined);
      } catch {
        respond(false, undefined, errorShape("EXTRACT_FAILED", "解压失败"));
      } finally {
        await rm(uploadDir, { recursive: true, force: true });
      }
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };
}
