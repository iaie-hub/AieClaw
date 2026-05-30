import { TenantServiceError } from "../errors.js";
import type { Mas4sGatewayPlugin } from "./aiemas-types.js";
import {
  strCoerce,
  errorShape,
  getAgentDownloadTempDir,
  type SimpleHandlers,
} from "./aiemas-utils.js";

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

      const tempDir = getAgentDownloadTempDir(agentId);
      const archivePath = `${tempDir}-export.zip`;

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

      const isSkill = Boolean(params["isSkill"]);
      const skillName = strCoerce(params["skillName"]);

      let uploadDir: string;
      if (isSkill && skillName) {
        uploadDir = getAgentDownloadTempDir(skillName);
      } else {
        const randomId = Math.random().toString(36).slice(2);
        uploadDir = nodePath.join(nodeOs.tmpdir(), `aiemas-upload-${randomId}`);
      }

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

  // ── aiemas.skills.import ──
  handlers["aiemas.skills.import"] = async ({ params, respond }) => {
    try {
      const archivePath = strCoerce(params["archivePath"]);
      const slug = strCoerce(params["slug"]);
      const workspace = strCoerce(params["workspace"]);

      if (!archivePath || !slug) {
        respond(false, undefined, errorShape("INVALID_PARAMS", "archivePath and slug required"));
        return;
      }

      const VALID_SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;
      if (!VALID_SLUG_PATTERN.test(slug)) {
        respond(false, undefined, errorShape("INVALID_PARAMS", "非法 Skill Slug 名称"));
        return;
      }

      const { access: fsAccess, rm, mkdir, readdir, readFile } = await import("node:fs/promises");
      const nodePath = await import("node:path");
      const nodeOs = await import("node:os");
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

      // Determine target skills directory
      let skillsDir: string;
      if (workspace) {
        skillsDir = nodePath.join(workspace, "skills");
      } else {
        // Read default skills directory from ~/.openclaw/openclaw.json
        let defaultSkillsDir: string | undefined;
        try {
          const configPath = nodePath.join(nodeOs.homedir(), ".openclaw", "openclaw.json");
          const configContent = await readFile(configPath, "utf8");
          const configJson = JSON.parse(configContent);
          const extraDirs = configJson.skills?.load?.extraDirs;
          if (Array.isArray(extraDirs) && extraDirs.length > 0) {
            defaultSkillsDir = extraDirs[0];
          }
        } catch (err) {
          console.error("[aiemas.skills.import] Failed to read openclaw.json:", err);
        }
        if (!defaultSkillsDir) {
          defaultSkillsDir = nodePath.join(nodeOs.homedir(), ".openclaw", "skills");
        }
        skillsDir = defaultSkillsDir;
      }

      const targetDir = nodePath.join(skillsDir, slug);
      const uploadDir = nodePath.dirname(archivePath);

      // Backend Uniqueness Check: Check if target directory already exists
      try {
        await fsAccess(targetDir);
        respond(
          false,
          undefined,
          errorShape("DUPLICATE_SLUG", `该技能 "${slug}" 已存在，请使用其他名称`),
        );
        await rm(uploadDir, { recursive: true, force: true });
        return;
      } catch {
        // Directory does not exist, safe to proceed
      }

      await mkdir(skillsDir, { recursive: true });

      // Unzip to a temporary folder to detect if it has a single nested directory
      const tempExtractDir = nodePath.join(
        nodeOs.tmpdir(),
        `aiemas-skill-temp-extract-${Math.random().toString(36).slice(2)}`,
      );
      await mkdir(tempExtractDir, { recursive: true });

      try {
        await execFileAsync("unzip", ["-o", archivePath, "-d", tempExtractDir]);

        // Find the root of the extracted skill (handling potential single nested folder)
        let extractedRoot = tempExtractDir;
        const entries = await readdir(tempExtractDir, { withFileTypes: true });

        if (entries.length === 1 && entries[0].isDirectory()) {
          extractedRoot = nodePath.join(tempExtractDir, entries[0].name);
        }

        // Validate skill structure (Missing SKILL.md validation)
        const subEntries = await readdir(extractedRoot);
        const hasSkillMd = subEntries.some(
          (name) => name.toLowerCase() === "skill.md" || name.toLowerCase() === "skills.md",
        );
        if (!hasSkillMd) {
          respond(
            false,
            undefined,
            errorShape("INVALID_SKILL", "解压成功，但未在压缩包中找到 SKILL.md 文件"),
          );
          return;
        }

        // Clean target directory if it already exists (redundancy fallback)
        await rm(targetDir, { recursive: true, force: true });
        await mkdir(targetDir, { recursive: true });

        // Copy files from extractedRoot to targetDir
        const { cp } = await import("node:fs/promises");
        await cp(extractedRoot, targetDir, { recursive: true });

        // Update the name field in the imported SKILL.md to match the new slug (Deduplication fix)
        const skillMdFileName = subEntries.find(
          (name) => name.toLowerCase() === "skill.md" || name.toLowerCase() === "skills.md"
        ) || "SKILL.md";
        const targetSkillMdPath = nodePath.join(targetDir, skillMdFileName);
        try {
          const mdContent = await readFile(targetSkillMdPath, "utf8");
          const updatedContent = mdContent.replace(/^name:\s*.*$/m, `name: ${slug}`);
          const { writeFile: fsWriteFile } = await import("node:fs/promises");
          await fsWriteFile(targetSkillMdPath, updatedContent, "utf8");
        } catch (err) {
          console.error("[aiemas.skills.import] Failed to update SKILL.md name:", err);
        }

        respond(true, { ok: true, slug, targetDir }, undefined);
      } catch (err) {
        respond(false, undefined, errorShape("EXTRACT_FAILED", "解压/导入失败: " + String(err)));
      } finally {
        await rm(tempExtractDir, { recursive: true, force: true });
        await rm(uploadDir, { recursive: true, force: true });
      }
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

  // ── aiemas.skills.delete ──
  handlers["aiemas.skills.delete"] = async ({ params, respond }) => {
    try {
      const skillKey = strCoerce(params["skillKey"]);
      const baseDir = strCoerce(params["baseDir"]);

      if (!skillKey || !baseDir) {
        respond(false, undefined, errorShape("INVALID_PARAMS", "skillKey and baseDir required"));
        return;
      }

      const nodePath = await import("node:path");
      const { access: fsAccess, rm, readdir } = await import("node:fs/promises");

      // Normalize directory path to prevent path traversal
      const resolvedDir = nodePath.resolve(baseDir);

      // 1. Safety check: ensure resolvedDir is absolute
      if (!nodePath.isAbsolute(resolvedDir)) {
        respond(false, undefined, errorShape("INVALID_PARAMS", "路径必须是绝对路径"));
        return;
      }

      // Prohibit deleting root or top-level user directories
      const lowercasePath = resolvedDir.toLowerCase().replace(/\\/g, "/");
      if (
        resolvedDir === "/" ||
        resolvedDir === "C:\\" ||
        lowercasePath.endsWith("/users") ||
        lowercasePath.endsWith("/users/admin") ||
        lowercasePath.endsWith("/desktop") ||
        lowercasePath.endsWith("/code") ||
        resolvedDir.split(nodePath.sep).length < 4
      ) {
        respond(false, undefined, errorShape("FORBIDDEN", "禁止删除敏感系统目录"));
        return;
      }

      // 2. Safety check: built-in skills protection
      // Reject if it contains openclaw-bundled or belongs to a core/builtin path
      if (
        lowercasePath.includes("openclaw-bundled") ||
        lowercasePath.includes("/node_modules/") ||
        (lowercasePath.includes("/aieclaw/skills/") && !lowercasePath.includes("/aiemas/"))
      ) {
        respond(false, undefined, errorShape("FORBIDDEN", "内置/系统技能不允许被删除"));
        return;
      }

      // 3. Safety check: Ensure the folder exists
      try {
        await fsAccess(resolvedDir);
      } catch {
        respond(false, undefined, errorShape("NOT_FOUND", "技能目录不存在"));
        return;
      }

      // 4. Safety check: Ensure the folder contains SKILL.md or skills.md to verify it is indeed a skill directory
      let isSkillDir = false;
      try {
        const subEntries = await readdir(resolvedDir);
        isSkillDir = subEntries.some(
          (name) => name.toLowerCase() === "skill.md" || name.toLowerCase() === "skills.md",
        );
      } catch (err) {
        respond(false, undefined, errorShape("READ_FAILED", "无法读取该目录以进行验证"));
        return;
      }

      if (!isSkillDir) {
        respond(
          false,
          undefined,
          errorShape("INVALID_SKILL", "指定的目录不是有效的 Skill 文件夹（未找到 SKILL.md）"),
        );
        return;
      }

      // 5. Perform recursive delete
      await rm(resolvedDir, { recursive: true, force: true });
      respond(true, { ok: true, skillKey, baseDir: resolvedDir }, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };
}

