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

@ApiTags("Papers")
@ApiBearerAuth()
@Controller("papers")
export class PaperController {
  constructor(
    private paperService: PaperService,
    private jwtService: JwtService,
  ) {}

  // ── CRUD ──

  @Get()
  @ApiOperation({ summary: "List all papers for current user" })
  async list(@Req() req: Request) {
    return { papers: await this.paperService.listPapers((req as any).user.sub) };
  }

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

  @Get(":id")
  @ApiOperation({ summary: "Get paper details" })
  async get(@Param("id") id: string) {
    return this.paperService.getPaper(id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete a paper" })
  async delete(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.deletePaper((req as any).user.sub, id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update paper metadata" })
  async update(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.paperService.updatePaper(id, body);
  }

  // ── Pipeline ──

  @Get(":id/pipeline/status")
  @ApiOperation({ summary: "Get pipeline status" })
  async pipelineStatus(@Param("id") id: string) {
    return this.paperService.getPipelineStatus(id);
  }

  @Post(":id/pipeline/start")
  @UseGuards(QuotaGuard)
  @ApiOperation({ summary: "Start full pipeline" })
  async pipelineStart(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.runPipeline(id, (req as any).user.sub);
  }

  @Post(":id/pipeline/brainstorm")
  @ApiOperation({ summary: "Run topic brainstorming" })
  async brainstorm(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.runBrainstorm(id, (req as any).user.sub);
  }

  @Post(":id/pipeline/search-literature")
  @ApiOperation({ summary: "Run literature search" })
  async searchLiterature(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.runLiteratureSearch(id, (req as any).user.sub);
  }

  @Post(":id/pipeline/outline")
  @ApiOperation({ summary: "Run outline generation" })
  async outline(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.runOutline(id, (req as any).user.sub);
  }

  @Post(":id/pipeline/reset")
  @ApiOperation({ summary: "Reset pipeline state" })
  async pipelineReset(@Param("id") id: string) {
    return this.paperService.resetPipeline(id);
  }

  @Post(":id/pipeline/write")
  @ApiOperation({ summary: "Run section writing" })
  async write(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.runWriting(id, (req as any).user.sub);
  }

  @Post(":id/pipeline/polish")
  @ApiOperation({ summary: "Run academic polish" })
  async polish(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.runPolish(id, (req as any).user.sub);
  }

  @Post(":id/detect-all")
  @ApiOperation({ summary: "Run AI detection on all sections" })
  async detectAll(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.runDetection(id, (req as any).user.sub);
  }

  @Post(":id/reduce-ai-all")
  @ApiOperation({ summary: "Run AI reduction on all sections" })
  async reduceAll(@Req() req: Request, @Param("id") id: string) {
    return this.paperService.runReduction(id, (req as any).user.sub);
  }

  @Get(":id/detection-stats")
  @ApiOperation({ summary: "Get AI detection scores" })
  async detectionStats(@Param("id") id: string) {
    return this.paperService.getDetectionStats(id);
  }

  @Get(":id/runtime-status")
  @ApiOperation({ summary: "Get runtime pipeline status" })
  async runtimeStatus(@Param("id") id: string) {
    return this.paperService.getRuntimeStatus(id);
  }

  // ── Sections ──

  @Get(":id/sections")
  @ApiOperation({ summary: "List all sections" })
  async listSections(@Param("id") id: string) {
    return { sections: await this.paperService.listSections(id) };
  }

  @Get(":id/sections/:num")
  @ApiOperation({ summary: "Get a section" })
  async getSection(@Param("id") id: string, @Param("num") num: string) {
    return this.paperService.getSection(id, num);
  }

  @Put(":id/sections/:num")
  @ApiOperation({ summary: "Save section content" })
  async saveSection(
    @Param("id") id: string,
    @Param("num") num: string,
    @Body() body: { content: string },
  ) {
    return this.paperService.saveSection(id, num, body);
  }

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

  @Get(":id/outline")
  @ApiOperation({ summary: "Get paper outline" })
  async getOutline(@Param("id") id: string) {
    return this.paperService.getOutline(id);
  }

  @Put(":id/outline")
  @ApiOperation({ summary: "Save paper outline" })
  async saveOutline(@Param("id") id: string, @Body() body: { outline: unknown }) {
    return this.paperService.saveOutline(id, body.outline);
  }

  // ── References ──

  @Get(":id/references")
  @ApiOperation({ summary: "List references" })
  async listReferences(@Param("id") id: string) {
    return { references: await this.paperService.listReferences(id) };
  }

  @Post(":id/references")
  @ApiOperation({ summary: "Add a reference" })
  async addReference(@Param("id") id: string, @Body() body: any) {
    return this.paperService.addReference(id, body);
  }

  @Put(":id/references/:refId")
  @ApiOperation({ summary: "Update a reference" })
  async updateReference(
    @Param("id") id: string,
    @Param("refId") refId: string,
    @Body() body: any,
  ) {
    return this.paperService.updateReference(id, refId, body);
  }

  @Delete(":id/references/:refId")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete a reference" })
  async deleteReference(@Param("id") id: string, @Param("refId") refId: string) {
    return this.paperService.deleteReference(id, refId);
  }

  // ── Innovations ──

  @Get(":id/innovations")
  @ApiOperation({ summary: "Get innovation points" })
  async getInnovations(@Param("id") id: string) {
    return { innovations: await this.paperService.getInnovations(id) };
  }

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

  private verifyExportToken(token: string) {
    if (!token) throw new UnauthorizedException("Token required");
    try { this.jwtService.verify(token); } catch {
      throw new UnauthorizedException("Invalid token");
    }
  }

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
