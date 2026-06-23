import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, Req, Res, Query, HttpCode, HttpStatus, UnauthorizedException,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from "@nestjs/swagger";
import { Request, Response } from "express";
import { JwtService } from "@nestjs/jwt";
import { PaperService } from "./paper.service.js";
import { QuotaGuard } from "../common/guards/quota.guard.js";
import { UseGuards } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator.js";

/**
 * PaperController — 论文 REST API 控制器
 *
 * 路由前缀：/api/v1/papers
 * 认证：全局 JWT 守卫（@Public() 标记的端点除外）
 *
 * 功能分组：
 * - CRUD：论文的增删改查
 * - Pipeline：流水线各阶段触发
 * - Sections：章节管理
 * - Outline：大纲管理
 * - References：参考文献管理
 * - Innovations：创新点管理
 * - Export：Word 导出
 *
 * @author zjh
 * @date 2026-06-02
 */
@ApiTags("Papers")
@ApiBearerAuth()
@Controller("papers")
export class PaperController {
  constructor(
    private paperService: PaperService,
    private jwtService: JwtService,
  ) {}

  // ── CRUD ──

  /** 获取当前用户的论文列表 */
  @Get()
  @ApiOperation({ summary: "List all papers for current user" })
  async list(@Req() req: Request) {
    return { papers: await this.paperService.listPapers((req as any).user.sub) };
  }

  /** 创建新论文（受配额守卫保护） */
  @Post()
  @UseGuards(QuotaGuard)
  @ApiOperation({ summary: "Create a new paper project" })
  @ApiResponse({ status: 201, description: "Paper created" })
  async create(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const result = await this.paperService.createPaper(
      (req as any).user.sub,
      body as any,
    );
    return { paper: result, statusCode: 201 };
  }

  /** 获取单篇论文详情 */
  @Get(":id")
  @ApiOperation({ summary: "Get paper details" })
  async get(@Param("id") id: string) {
    return this.paperService.getPaper(id);
  }

  /** 删除论文 */
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete a paper" })
  async delete(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.deletePaper((req as any).user.sub, id);
  }

  /** 更新论文元数据 */
  @Patch(":id")
  @ApiOperation({ summary: "Update paper metadata" })
  async update(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.paperService.updatePaper(id, body);
  }

  // ── Pipeline ──

  /** 获取流水线状态 */
  @Get(":id/pipeline/status")
  @ApiOperation({ summary: "Get pipeline status" })
  async pipelineStatus(@Param("id") id: string) {
    return this.paperService.getPipelineStatus(id);
  }

  /** 启动完整流水线（受配额守卫保护） */
  @Post(":id/pipeline/start")
  @UseGuards(QuotaGuard)
  @ApiOperation({ summary: "Start full pipeline" })
  async pipelineStart(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.runPipeline(id, (req as any).user.sub);
  }

  /** 仅运行选题构思 */
  @Post(":id/pipeline/brainstorm")
  @ApiOperation({ summary: "Run topic brainstorming" })
  async brainstorm(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.runBrainstorm(id, (req as any).user.sub);
  }

  /** 仅运行文献检索 */
  @Post(":id/pipeline/search-literature")
  @ApiOperation({ summary: "Run literature search" })
  async searchLiterature(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.runLiteratureSearch(id, (req as any).user.sub);
  }

  /** 仅运行大纲生成 */
  @Post(":id/pipeline/outline")
  @ApiOperation({ summary: "Run outline generation" })
  async outline(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.runOutline(id, (req as any).user.sub);
  }

  /** 重置流水线状态 */
  @Post(":id/pipeline/reset")
  @ApiOperation({ summary: "Reset pipeline state" })
  async pipelineReset(@Param("id") id: string) {
    return this.paperService.resetPipeline(id);
  }

  /** 仅运行正文撰写 */
  @Post(":id/pipeline/write")
  @ApiOperation({ summary: "Run section writing" })
  async write(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.runWriting(id, (req as any).user.sub);
  }

  /** 仅运行润色降重 */
  @Post(":id/pipeline/polish")
  @ApiOperation({ summary: "Run academic polish" })
  async polish(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.runPolish(id, (req as any).user.sub);
  }

  /** 运行全章节 AI 检测 */
  @Post(":id/detect-all")
  @ApiOperation({ summary: "Run AI detection on all sections" })
  async detectAll(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.runDetection(id, (req as any).user.sub);
  }

  /** 运行全章节 AI 降重 */
  @Post(":id/reduce-ai-all")
  @ApiOperation({ summary: "Run AI reduction on all sections" })
  async reduceAll(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.runReduction(id, (req as any).user.sub);
  }

  /** 获取 AI 检测分数 */
  @Get(":id/detection-stats")
  @ApiOperation({ summary: "Get AI detection scores" })
  async detectionStats(@Param("id") id: string) {
    return this.paperService.getDetectionStats(id);
  }

  /** 获取运行时流水线状态 */
  @Get(":id/runtime-status")
  @ApiOperation({ summary: "Get runtime pipeline status" })
  async runtimeStatus(@Param("id") id: string) {
    return this.paperService.getRuntimeStatus(id);
  }

  // ── Sections ──

  /** 获取论文章节列表 */
  @Get(":id/sections")
  @ApiOperation({ summary: "List all sections" })
  async listSections(@Param("id") id: string) {
    return { sections: await this.paperService.listSections(id) };
  }

  /** 获取单个章节内容 */
  @Get(":id/sections/:num")
  @ApiOperation({ summary: "Get a section" })
  async getSection(@Param("id") id: string, @Param("num") num: string) {
    return this.paperService.getSection(id, num);
  }

  /** 保存章节内容 */
  @Put(":id/sections/:num")
  @ApiOperation({ summary: "Save section content" })
  async saveSection(
    @Param("id") id: string,
    @Param("num") num: string,
    @Body() body: { content: string },
  ) {
    return this.paperService.saveSection(id, num, body);
  }

  /** 重新生成指定章节 */
  @Post(":id/sections/:num/regenerate")
  @ApiOperation({ summary: "Regenerate a single section" })
  async regenerateSection(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("num") num: string,
  ) {
    return this.paperService.regenerateSection(id, num, (req as any).user.sub);
  }

  // ── Outline ──

  /** 获取论文大纲 */
  @Get(":id/outline")
  @ApiOperation({ summary: "Get paper outline" })
  async getOutline(@Param("id") id: string) {
    return this.paperService.getOutline(id);
  }

  /** 保存论文大纲 */
  @Put(":id/outline")
  @ApiOperation({ summary: "Save paper outline" })
  async saveOutline(@Param("id") id: string, @Body() body: { outline: unknown }) {
    return this.paperService.saveOutline(id, body.outline);
  }

  // ── References ──

  /** 获取参考文献列表 */
  @Get(":id/references")
  @ApiOperation({ summary: "List references" })
  async listReferences(@Param("id") id: string) {
    return { references: await this.paperService.listReferences(id) };
  }

  /** 添加参考文献 */
  @Post(":id/references")
  @ApiOperation({ summary: "Add a reference" })
  async addReference(@Param("id") id: string, @Body() body: any) {
    return this.paperService.addReference(id, body);
  }

  /** 更新参考文献 */
  @Put(":id/references/:refId")
  @ApiOperation({ summary: "Update a reference" })
  async updateReference(
    @Param("id") id: string,
    @Param("refId") refId: string,
    @Body() body: any,
  ) {
    return this.paperService.updateReference(id, refId, body);
  }

  /** 删除参考文献 */
  @Delete(":id/references/:refId")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete a reference" })
  async deleteReference(@Param("id") id: string, @Param("refId") refId: string) {
    return this.paperService.deleteReference(id, refId);
  }

  // ── Innovations ──

  /** 获取创新点列表 */
  @Get(":id/innovations")
  @ApiOperation({ summary: "Get innovation points" })
  async getInnovations(@Param("id") id: string) {
    return { innovations: await this.paperService.getInnovations(id) };
  }

  /** 更新创新点 */
  @Put(":id/innovations/:pointId")
  @ApiOperation({ summary: "Update an innovation point" })
  async updateInnovation(
    @Param("id") id: string,
    @Param("pointId") pointId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.paperService.updateInnovation(id, pointId, body);
  }

  // ── Export ──

  /**
   * 下载导出的论文（GET 方式）
   * 需要通过 ?token= 传递 JWT（绕过全局守卫）
   */
  @Public()
  @Get(":id/export/:format")
  @ApiOperation({ summary: "Download exported paper (GET, token via ?token=)" })
  async downloadExport(
    @Param("id") id: string,
    @Param("format") format: string,
    @Query("token") token: string,
    @Res() res: Response,
  ) {
    this.verifyExportToken(token);
    return this.sendExportFile(id, format, res);
  }

  /**
   * 导出论文（POST 方式）
   * 支持 ?token= 或 Authorization: Bearer 两种方式传递 JWT
   */
  @Public()
  @Post(":id/export/:format")
  @ApiOperation({ summary: "Export paper (POST, token via ?token= or Bearer)" })
  async exportPaper(
    @Param("id") id: string,
    @Param("format") format: string,
    @Query("token") token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const tok = token || (req.headers.authorization ?? "").replace("Bearer ", "");
    this.verifyExportToken(tok);
    return this.sendExportFile(id, format, res);
  }

  /** 验证导出 Token 的有效性 */
  private verifyExportToken(token: string) {
    if (!token) throw new UnauthorizedException("Token required");
    try { this.jwtService.verify(token); } catch {
      throw new UnauthorizedException("Invalid token");
    }
  }

  /**
   * 发送导出文件给客户端
   * 包含 30 秒超时保护（防止 Mermaid 渲染网络不通导致无限挂起）
   * @param id - 论文 ID
   * @param format - 导出格式
   * @param res - Express Response 对象
   */
  private async sendExportFile(id: string, format: string, res: Response) {
    // 30 秒超时，防止 Mermaid render 网络不通导致无限挂起
    const result = await Promise.race([
      this.paperService.exportPaper(id, format),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("导出超时，请重试")), 30_000)),
    ]);
    const { readFile } = await import("node:fs/promises");
    const path = result.filePath;
    const rawFilename = path.split(/[\/\\]/).pop() || "paper.docx";
    const encodedFilename = encodeURIComponent(rawFilename);
    const buffer = await readFile(path);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition",
      `attachment; filename="paper.docx"; filename*=UTF-8''${encodedFilename}`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  }
}
