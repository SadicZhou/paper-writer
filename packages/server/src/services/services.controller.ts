import { Controller, Get, Post, Put, Delete, Body, Param, Req, HttpCode, HttpStatus } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { Request } from "express";
import { ServicesService } from "./services.service.js";

@ApiTags("Services")
@ApiBearerAuth()
@Controller("services")
export class ServicesController {
  constructor(private servicesService: ServicesService) {}

  @Get()
  @ApiOperation({ summary: "List service configs for current user" })
  async list(@Req() req: Request) {
    return this.servicesService.listByUser((req as any).user.sub);
  }

  @Get("config")
  @ApiOperation({ summary: "Get raw service config list" })
  async config(@Req() req: Request) {
    return this.servicesService.listByUser((req as any).user.sub);
  }

  @Put("config")
  @ApiOperation({ summary: "Save full service config (upsert)" })
  async saveConfig(@Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.servicesService.saveConfig((req as any).user.sub, body);
  }

  @Post()
  @ApiOperation({ summary: "Create a new service config" })
  async create(@Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.servicesService.create((req as any).user.sub, body as any);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one service config" })
  async getOne(@Req() req: Request, @Param("id") id: string) {
    return this.servicesService.getById((req as any).user.sub, id);
  }

  @Put(":id")
  @ApiOperation({ summary: "Update service config" })
  async update(@Req() req: Request, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.servicesService.update((req as any).user.sub, id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete service config" })
  async delete(@Req() req: Request, @Param("id") id: string) {
    return this.servicesService.delete((req as any).user.sub, id);
  }

  @Put(":id/secret")
  @ApiOperation({ summary: "Update API key for a service" })
  async updateSecret(@Req() req: Request, @Param("id") id: string, @Body() body: { apiKey: string }) {
    return this.servicesService.updateSecret((req as any).user.sub, id, body.apiKey);
  }

  @Get(":id/secret")
  @ApiOperation({ summary: "Get API key status (masked)" })
  async getSecret(@Req() req: Request, @Param("id") id: string) {
    return this.servicesService.getSecret((req as any).user.sub, id);
  }

  @Post(":id/test")
  @ApiOperation({ summary: "Test service connection" })
  async testConnection(@Req() req: Request, @Param("id") id: string) {
    return this.servicesService.testConnection((req as any).user.sub, id);
  }
}
