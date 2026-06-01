import { useState } from "react";
import { ArrowLeft, Loader2, Upload } from "lucide-react";

interface Nav {
  toPaperWorkspace: (paperId: string) => void;
}

export function ImportWord({ paperId, nav }: { paperId: string; nav: Nav }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/v1/papers/${encodeURIComponent(paperId)}/import-word`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <button
        onClick={() => nav.toPaperWorkspace(paperId)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <ArrowLeft size={14} />
        <span>返回工作台</span>
      </button>

      <h1 className="text-xl font-bold mb-6">导入 Word 文档</h1>

      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          上传带有批注或修订标记的 .docx 文件。AI 将解析批注并逐条处理修改建议。
        </p>

        <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
          <input
            type="file"
            accept=".docx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="hidden"
            id="docx-upload"
          />
          <label
            htmlFor="docx-upload"
            className="cursor-pointer flex flex-col items-center gap-2"
          >
            <Upload size={32} className="text-muted-foreground" />
            <span className="text-sm">
              {file ? file.name : "选择 .docx 文件"}
            </span>
            <span className="text-xs text-muted-foreground">
              拖拽或点击选择文件
            </span>
          </label>
        </div>

        <button
          onClick={() => void handleUpload()}
          disabled={!file || uploading}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          <span>{uploading ? "导入中..." : "开始导入"}</span>
        </button>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-500">
            {error}
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-border bg-secondary/20 p-4">
            <pre className="text-xs whitespace-pre-wrap">{result}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
