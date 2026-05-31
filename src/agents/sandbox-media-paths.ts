import path from "node:path";
import { resolveMediaReferenceSandboxPath } from "../media/media-reference.js";
import { assertSandboxPath } from "./sandbox-paths.js";
import type { SandboxFsBridge, SandboxResolvedPath } from "./sandbox/fs-bridge.js";
import { isPathInsideContainerRoot, normalizeContainerPath } from "./sandbox/path-utils.js";

export type SandboxedBridgeMediaPathConfig = {
  root: string;
  bridge: SandboxFsBridge;
  workspaceOnly?: boolean;
};

export function createSandboxBridgeReadFile(params: {
  sandbox: Pick<SandboxedBridgeMediaPathConfig, "root" | "bridge">;
}): (filePath: string) => Promise<Buffer> {
  return async (filePath: string) =>
    await params.sandbox.bridge.readFile({
      filePath,
      cwd: params.sandbox.root,
    });
}

export async function resolveSandboxedBridgeMediaPath(params: {
  sandbox: SandboxedBridgeMediaPathConfig;
  mediaPath: string;
  inboundFallbackDir?: string;
  recentFallback?: boolean;
}): Promise<{ resolved: string; rewrittenFrom?: string }> {
  const normalizeFileUrl = (rawPath: string) =>
    rawPath.startsWith("file://") ? rawPath.slice("file://".length) : rawPath;
  const mediaPathInfo = params.inboundFallbackDir
    ? resolveMediaReferenceSandboxPath(params.mediaPath, params.inboundFallbackDir)
    : { resolved: params.mediaPath };
  const filePath = normalizeFileUrl(mediaPathInfo.resolved);
  const rewrittenFrom = mediaPathInfo.rewrittenFrom;
  if (rewrittenFrom) {
    const stat = await params.sandbox.bridge.stat({
      filePath,
      cwd: params.sandbox.root,
    });
    if (!stat) {
      throw new Error(`Sandbox media reference is not staged: ${rewrittenFrom}`);
    }
  }
  const enforceWorkspaceBoundary = async (resolved: SandboxResolvedPath) => {
    if (!params.sandbox.workspaceOnly) {
      return;
    }
    if (resolved.hostPath) {
      await assertSandboxPath({
        filePath: resolved.hostPath,
        cwd: params.sandbox.root,
        root: params.sandbox.root,
      });
      return;
    }
    const workspaceRoot = params.sandbox.bridge.resolvePath({
      filePath: params.sandbox.root,
      cwd: params.sandbox.root,
    });
    if (
      !isPathInsideContainerRoot(
        normalizeContainerPath(workspaceRoot.containerPath),
        normalizeContainerPath(resolved.containerPath),
      )
    ) {
      throw new Error(`Sandbox path escapes workspace root: ${resolved.containerPath}`);
    }
  };

  const resolveDirect = () =>
    params.sandbox.bridge.resolvePath({
      filePath,
      cwd: params.sandbox.root,
    });
  try {
    const resolved = resolveDirect();
    await enforceWorkspaceBoundary(resolved);
    return {
      resolved: resolved.hostPath ?? resolved.containerPath,
      ...(rewrittenFrom ? { rewrittenFrom } : {}),
    };
  } catch (err) {
    const fallbackDir = params.inboundFallbackDir?.trim();
    if (!fallbackDir) {
      throw err;
    }

    const baseName = path.basename(filePath);
    let fallbackPath = path.join(fallbackDir, baseName);
    let resolvedFallback: SandboxResolvedPath | null = null;

    try {
      const stat = await params.sandbox.bridge.stat({
        filePath: fallbackPath,
        cwd: params.sandbox.root,
      });
      if (stat) {
        resolvedFallback = params.sandbox.bridge.resolvePath({
          filePath: fallbackPath,
          cwd: params.sandbox.root,
        });
      }
    } catch {
      // Not found, check recent fallback if enabled
    }

    const isGenericHandle = baseName === "image" || baseName.startsWith("image-");
    if (!resolvedFallback && params.recentFallback && isGenericHandle) {
      try {
        const files = await params.sandbox.bridge.readdir({
          filePath: fallbackDir,
          cwd: params.sandbox.root,
        });
        const imageFiles = files.filter((f) => /\.(png|jpg|jpeg|webp|gif|bmp|heic|heif)$/i.test(f));
        if (imageFiles.length > 0) {
          const stats = await Promise.all(
            imageFiles.map(async (f) => ({
              name: f,
              stat: await params.sandbox.bridge.stat({
                filePath: path.join(fallbackDir, f),
                cwd: params.sandbox.root,
              }),
            })),
          );
          const sorted = stats
            .filter((s) => s.stat !== null)
            .toSorted((a, b) => (b.stat?.mtimeMs ?? 0) - (a.stat?.mtimeMs ?? 0));
          if (sorted[0]) {
            fallbackPath = path.join(fallbackDir, sorted[0].name);
            resolvedFallback = params.sandbox.bridge.resolvePath({
              filePath: fallbackPath,
              cwd: params.sandbox.root,
            });
          }
        }
      } catch {
        // readdir/stat failed, ignore and throw original err
      }
    }

    if (!resolvedFallback) {
      throw err;
    }
    await enforceWorkspaceBoundary(resolvedFallback);
    return {
      resolved: resolvedFallback.hostPath ?? resolvedFallback.containerPath,
      rewrittenFrom: filePath,
    };
  }
}
