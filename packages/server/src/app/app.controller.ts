import { Controller, Get, Put, Body } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { AppService } from "./app.service.js";
import { Public } from "../common/decorators/public.decorator.js";

@ApiTags("App")
@Controller()
export class AppController {
  constructor(private appService: AppService) {}

  @Public()
  @Get("project")
  @ApiOperation({ summary: "Get project config (public)" })
  async getProject() {
    return this.appService.getProjectConfig();
  }

  @Put("project")
  @ApiOperation({ summary: "Update project config" })
  async updateProject(@Body() body: Record<string, unknown>) {
    return this.appService.updateProjectConfig(body);
  }

  @Get("project/model-overrides")
  @ApiOperation({ summary: "Get model overrides" })
  async getModelOverrides() {
    const config = await this.appService.getProjectConfig();
    return { modelOverrides: (config as any).modelOverrides ?? {} };
  }

}
