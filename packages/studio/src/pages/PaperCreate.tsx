import { useState } from "react";
import { postApi } from "../hooks/use-api";
import { ArrowLeft, Loader2 } from "lucide-react";

interface Nav {
  toDashboard: () => void;
  toPaper: (id: string) => void;
}

export function PaperCreate({ nav }: { nav: Nav }) {
  const [title, setTitle] = useState("");
  const [major, setMajor] = useState("");
  const [degreeLevel, setDegreeLevel] = useState<"undergraduate" | "master" | "doctor">("undergraduate");
  const [proposalText, setProposalText] = useState("");
  const [targetWordCount, setTargetWordCount] = useState(20000);
  const [citationFormat, setCitationFormat] = useState<"gb7714" | "apa" | "mla" | "chicago">("gb7714");
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [referencesText, setReferencesText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError("请输入论文标题");
      return;
    }
    if (!major.trim()) {
      setError("请输入专业方向");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      // Parse references from text (one per line, format: authors. title. journal, year.)
      const references = referencesText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, i) => ({
          id: `ref-${i + 1}`,
          type: "journal" as const,
          title: line,
          authors: [] as string[],
          year: new Date().getFullYear(),
          rawCitation: line,
        }));

      const result = await postApi<{ id: string }>("/papers", {
        title: title.trim(),
        major: major.trim(),
        degreeLevel,
        proposalText: proposalText.trim(),
        targetWordCount,
        citationFormat,
        language,
        references,
      });

      nav.toPaper(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={nav.toDashboard}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft size={14} />
        <span>返回</span>
      </button>

      <h1 className="text-2xl font-bold tracking-tight mb-8">新建论文</h1>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-500">
          {error}
        </div>
      )}

      <div className="space-y-5">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium mb-1.5">论文标题</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入论文标题"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
        </div>

        {/* Major + Degree */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">专业方向</label>
            <input
              value={major}
              onChange={(e) => setMajor(e.target.value)}
              placeholder="如: 计算机科学"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">学位层次</label>
            <select
              value={degreeLevel}
              onChange={(e) => setDegreeLevel(e.target.value as typeof degreeLevel)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
            >
              <option value="undergraduate">本科</option>
              <option value="master">硕士</option>
              <option value="doctor">博士</option>
            </select>
          </div>
        </div>

        {/* Target words + Citation format */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">目标字数</label>
            <input
              type="number"
              value={targetWordCount}
              onChange={(e) => setTargetWordCount(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">引用格式</label>
            <select
              value={citationFormat}
              onChange={(e) => setCitationFormat(e.target.value as typeof citationFormat)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
            >
              <option value="gb7714">GB/T 7714</option>
              <option value="apa">APA 7th</option>
              <option value="mla">MLA 9th</option>
              <option value="chicago">Chicago</option>
            </select>
          </div>
        </div>

        {/* Language */}
        <div>
          <label className="block text-sm font-medium mb-1.5">写作语言</label>
          <div className="flex gap-2">
            {(["zh", "en"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLanguage(l)}
                className={`px-4 py-1.5 rounded-lg text-sm border transition-colors ${
                  language === l
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-border/80"
                }`}
              >
                {l === "zh" ? "中文" : "English"}
              </button>
            ))}
          </div>
        </div>

        {/* Proposal text */}
        <div>
          <label className="block text-sm font-medium mb-1.5">开题报告</label>
          <textarea
            value={proposalText}
            onChange={(e) => setProposalText(e.target.value)}
            placeholder="粘贴开题报告内容（可选，但推荐提供以获得更好的选题建议）"
            rows={6}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 resize-y"
          />
        </div>

        {/* References */}
        <div>
          <label className="block text-sm font-medium mb-1.5">参考文献（每行一条）</label>
          <textarea
            value={referencesText}
            onChange={(e) => setReferencesText(e.target.value)}
            placeholder={`张三, 李四. 论文标题示例[J]. 期刊名, 2024.\n王五. 另一篇论文[M]. 出版社, 2023.`}
            rows={4}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 resize-y font-mono text-xs"
          />
        </div>

        {/* Submit */}
        <button
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          <span>{submitting ? "创建中..." : "创建论文项目"}</span>
        </button>
      </div>
    </div>
  );
}
