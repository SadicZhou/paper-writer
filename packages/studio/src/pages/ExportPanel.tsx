import { useApi } from "../hooks/use-api";
import { ArrowLeft, Loader2, Download, FileText } from "lucide-react";
import { useState } from "react";
import { downloadPaperDocx } from "../lib/download-paper-docx";

interface Nav {
  toPaperWorkspace: (paperId: string) => void;
}

export function ExportPanel({ paperId, nav }: { paperId: string; nav: Nav }) {
  const { data: paper } = useApi<{ title: string; citationFormat: string; targetWordCount: number }>(`/papers/${paperId}`);
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<"docx">("docx");

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadPaperDocx(paperId);
    } finally {
      setExporting(false);
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

      <h1 className="text-xl font-bold mb-6">导出论文</h1>

      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        {paper && (
          <div className="text-sm text-muted-foreground space-y-1 mb-4">
            <p>标题: {paper.title}</p>
            <p>引用格式: {paper.citationFormat.toUpperCase()}</p>
            <p>目标字数: {paper.targetWordCount.toLocaleString()}</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-2">导出格式</label>
          <div className="flex gap-2">
            {(["docx"] as const).map((fmt) => (
              <button
                key={fmt}
                onClick={() => setExportFormat(fmt)}
                className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                  exportFormat === fmt
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-border/80"
                }`}
              >
                {fmt.toUpperCase()} (Word)
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => void handleExport()}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          <span>{exporting ? "导出中..." : "导出 Word 文档"}</span>
        </button>

        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">导出内容包括：</p>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li>封面页（标题、专业、日期）</li>
            <li>中文摘要 + 关键词</li>
            <li>英文摘要 + 关键词</li>
            <li>目录（自动生成）</li>
            <li>正文（含图表标注）</li>
            <li>参考文献（按选定格式排版）</li>
            <li>致谢</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
