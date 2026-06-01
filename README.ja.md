<p align="center">
  <img src="assets/logo.svg" width="96" height="96" alt="Paper Writer Logo">
</p>

<h1 align="center">Paper Writer<br><sub>AI 学術論文執筆エージェント</sub></h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="License: AGPL-3.0"></a>
</p>

<p align="center">
  <a href="README.md">中文</a> | <a href="README.en.md">English</a> | 日本語
</p>

---

AI エージェントが学術論文を自律的に執筆——トピック立案、文献検索、アウトライン生成からセクション執筆、AI検出・低減、学術ポリッシュまでを自動化。学士論文・修士論文・博士論文に対応。GB7714 / APA / MLA / Chicago の引用形式を内蔵。

**Paper Writer Studio リリース！** — `inkos` でローカル Web ワークベンチを起動。

## クイックスタート

```bash
pnpm install && pnpm build
```

`.env` で LLM を設定：

```bash
INKOS_LLM_API_KEY=sk-...
INKOS_LLM_MODEL=deepseek-v4-flash
INKOS_LLM_BASE_URL=https://api.deepseek.com/anthropic
```

論文を書く：

```bash
inkos paper create --title "論文タイトル" --major "情報工学" --degree master
inkos paper generate <paper-id>   # 全パイプライン実行
inkos paper export <paper-id>     # Word 出力
```

## パイプライン

| Agent | 役割 |
|-------|------|
| Topic Brainstormer | トピック分析・革新点抽出 |
| Literature Searcher | 文献検索・レビュー生成 |
| Outline Builder | 章構成の計画 |
| Section Writer | 逐次セクション執筆 |
| Academic Polisher | 学術表現の最適化 |
| AI Detection Auditor | AIGC 検出スコアリング |
| AI Reduction Reviser | AI 痕跡の低減リライト |
| Citation Formatter | 引用フォーマット（GB7714/APA/MLA/Chicago） |
| Word Exporter | .docx エクスポート |

## 開発

```bash
pnpm dev              # 全パッケージ watch モード
pnpm test             # テスト実行
pnpm build            # ビルド
```

## ライセンス

[AGPL-3.0](LICENSE)
