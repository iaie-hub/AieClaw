import { uploadFile, importAgent } from "../../gateway/agents-api.js";
import { getClient } from "../../gateway/client.js";
import type { AgentEntry } from "../../types/agents-types.js";

export interface ImportConfirmDetail {
  file: File;
  agentId: string;
  workspace: string;
}

export interface ImportResult {
  ok: true;
  agent: AgentEntry;
}

export interface ImportError {
  ok: false;
  message: string;
}

/**
 * 导入智能体的业务逻辑控制器。
 * 封装：读取文件 → base64 编码 → 上传临时文件 → 调用 aiemas.agents.import。
 * 与 UI 解耦，便于独立测试和复用。
 */
export async function runAgentImport(
  detail: ImportConfirmDetail,
): Promise<ImportResult | ImportError> {
  try {
    const client = getClient();
    const { file, agentId, workspace } = detail;

    const data = await readFileAsBase64(file);
    const { filePath } = await uploadFile(client, file.name, data);
    const agent = await importAgent(client, filePath, agentId, workspace);

    return { ok: true, agent };
  } catch (err: unknown) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "导入失败",
    };
  }
}

/** 将 File 读取为 base64 字符串（去掉 data URL 前缀）。 */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    });
    reader.addEventListener("error", () => reject(new Error("读取文件失败")));
    reader.readAsDataURL(file);
  });
}
