import path from "node:path";
import { assertSandboxPath } from "./sandbox-paths.js";
import type { SandboxFsBridge, SandboxResolvedPath } from "./sandbox/fs-bridge.js";

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
  const filePath = normalizeFileUrl(params.mediaPath);
  const enforceWorkspaceBoundary = async (hostPath: string) => {
    if (!params.sandbox.workspaceOnly) {
      return;
    }
    await assertSandboxPath({
      filePath: hostPath,
      cwd: params.sandbox.root,
      root: params.sandbox.root,
    });
  };

  const resolveDirect = () =>
    params.sandbox.bridge.resolvePath({
      filePath,
      cwd: params.sandbox.root,
    });
  try {
    const resolved = resolveDirect();
    if (resolved.hostPath) {
      await enforceWorkspaceBoundary(resolved.hostPath);
    }
    return { resolved: resolved.hostPath ?? resolved.containerPath };
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

    if (resolvedFallback.hostPath) {
      await enforceWorkspaceBoundary(resolvedFallback.hostPath);
    }
    return {
      resolved: resolvedFallback.hostPath ?? resolvedFallback.containerPath,
      rewrittenFrom: filePath,
    };
  }
}
