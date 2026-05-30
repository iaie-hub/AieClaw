import { getClient } from "../../gateway/client.js";
import { importSkill } from "../../gateway/skills-api.js";

export interface SkillImportConfirmDetail {
  file: File;
  slug: string;
  workspace?: string;
}

export interface SkillImportResult {
  ok: true;
  slug: string;
  targetDir: string;
}

export interface SkillImportError {
  ok: false;
  message: string;
}

/**
 * 导入 Skill 的业务逻辑控制器。
 * 封装：读取文件 → base64 编码 → 上传至专用临时目录（带 isSkill 和 skillName 参数） → 调用 aiemas.skills.import。
 */
export async function runSkillImport(
  detail: SkillImportConfirmDetail,
): Promise<SkillImportResult | SkillImportError> {
  try {
    const client = getClient();
    const { file, slug, workspace } = detail;

    const data = await readFileAsBase64(file);

    // 调用 aiemas.file.upload 将文件传到专用下载目录
    const { filePath } = await client.request<{ filePath: string }>("aiemas.file.upload", {
      fileName: file.name,
      data,
      isSkill: true,
      skillName: slug,
    });

    const res = await importSkill(client, filePath, slug, workspace);

    return { ok: true, slug: res.slug, targetDir: res.targetDir };
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
