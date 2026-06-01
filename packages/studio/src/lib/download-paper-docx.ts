/**
 * 从导出接口拉取 docx 二进制并触发浏览器下载。
 * @author zjh
 * @date 2026-05-12
 */
export function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const mStar = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (mStar?.[1]) {
    try {
      return decodeURIComponent(mStar[1].trim());
    } catch {
      return mStar[1].trim();
    }
  }
  const m = header.match(/filename="([^"]+)"/i);
  return m?.[1]?.trim() ?? null;
}

/**
 * POST /papers/:id/export/docx，响应为 Word 二进制流。
 */
export async function downloadPaperDocx(paperId: string): Promise<void> {
  const url = `/api/v1/papers/${encodeURIComponent(paperId)}/export/docx`;
  const token = (() => {
    try {
      const raw = localStorage.getItem("paper_writer_auth");
      return raw ? JSON.parse(raw).accessToken ?? "" : "";
    } catch {
      return "";
    }
  })();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: "{}",
  });
  if (!res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    let msg = `导出失败 (${res.status})`;
    if (ct.includes("application/json")) {
      try {
        const j = (await res.json()) as { error?: string };
        if (typeof j.error === "string" && j.error.trim()) msg = j.error;
      } catch {
        /* ignore */
      }
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const name =
    parseFilenameFromContentDisposition(res.headers.get("content-disposition"))
    ?? `paper-${paperId}.docx`;
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
