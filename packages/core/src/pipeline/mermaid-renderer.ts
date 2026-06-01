export interface MermaidRenderResult {
  readonly buffer: Buffer;
  readonly format: "png" | "jpg";
  readonly width: number;
  readonly height: number;
}

// Module-level cache: same mermaid code always produces the same image.
// Shared across instances to bridge verifier → exporter temporal gap.
const renderCache = new Map<string, MermaidRenderResult>();

/**
 * Server-side Mermaid diagram renderer using the mermaid.ink public API.
 *
 * Encoding: base64url(mermaidCode) — no compression needed.
 * The /img endpoint with ?type=jpeg&width=2400&scale=2 returns a high-res JPEG.
 * Built-in retry (3 attempts, exponential backoff) for transient failures.
 * Module-level cache avoids re-fetching identical diagrams.
 */
export class MermaidRenderer {
  private endpoint: string;
  private maxRetries: number;

  constructor(endpoint = "https://mermaid.ink", maxRetries = 3) {
    this.endpoint = endpoint;
    this.maxRetries = maxRetries;
  }

  async render(mermaidCode: string): Promise<MermaidRenderResult> {
    const cached = renderCache.get(mermaidCode);
    if (cached) return cached;

    const result = await this.renderWithRetry(mermaidCode);
    renderCache.set(mermaidCode, result);
    return result;
  }

  private async renderWithRetry(code: string): Promise<MermaidRenderResult> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await this.renderOnce(code);
      } catch (e: unknown) {
        lastError = e instanceof Error ? e : new Error(String(e));
        const status = this.extractHttpStatus(lastError);
        // 4xx (except 429) = permanent error from mermaid.ink — don't retry
        if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
          throw lastError;
        }
        if (attempt < this.maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError!;
  }

  private async renderOnce(mermaidCode: string): Promise<MermaidRenderResult> {
    const encoded = this.encodeForInk(mermaidCode);
    const url = `${this.endpoint}/img/${encoded}?type=jpeg&width=2400&scale=2`;

    const resp = await fetch(url);

    if (!resp.ok) {
      const snippet = mermaidCode.replace(/\n/g, " ").slice(0, 120);
      throw new Error(
        `Mermaid render failed: HTTP ${resp.status} ${resp.statusText} — ` +
        `"${snippet}${mermaidCode.length > 120 ? "..." : ""}"`,
      );
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    const { width, height } = this.parseImageDimensions(buffer);

    return { buffer, format: "jpg", width, height };
  }

  private extractHttpStatus(error: Error): number | undefined {
    const m = error.message.match(/HTTP (\d+)/);
    return m ? parseInt(m[1]!, 10) : undefined;
  }

  private encodeForInk(code: string): string {
    return Buffer.from(code, "utf-8").toString("base64url");
  }

  private parseImageDimensions(buffer: Buffer): { width: number; height: number } {
    // PNG: 8-byte signature \x89PNG, then IHDR at offset 8.
    if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
      const w = buffer.readUInt32BE(16);
      const h = buffer.readUInt32BE(20);
      return { width: w || 600, height: h || 400 };
    }
    // JPEG: starts with 0xFF 0xD8. Scan for SOF marker (0xC0 or 0xC2).
    if (buffer.length >= 10 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let i = 2;
      while (i < buffer.length - 9) {
        if (buffer[i] !== 0xff) { i++; continue; }
        const marker = buffer[i + 1];
        if (marker === 0xc0 || marker === 0xc2) {
          const h = buffer.readUInt16BE(i + 5);
          const w = buffer.readUInt16BE(i + 7);
          return { width: w || 600, height: h || 400 };
        }
        i += 2 + buffer.readUInt16BE(i + 2);
      }
    }
    return { width: 600, height: 400 };
  }
}
