import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { AdminService } from "./admin.service.js";
import { ServicesService } from "../services/services.service.js";
import { Roles } from "../common/decorators/roles.decorator.js";
import { RolesGuard } from "../common/guards/roles.guard.js";

@ApiTags("Admin")
@ApiBearerAuth()
@Controller("admin")
@UseGuards(RolesGuard)
@Roles("admin")
export class AdminController {
  constructor(
    private adminService: AdminService,
    private servicesService: ServicesService,
  ) {}

  // ── Users ──

  @Get("users")
  @ApiOperation({ summary: "List all users with pagination" })
  async listUsers(@Query("page") page?: string, @Query("limit") limit?: string) {
    return this.adminService.listUsers(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Post("users")
  @ApiOperation({ summary: "Create a new user" })
  async createUser(@Body() body: {
    username: string; password: string; role?: string; displayName?: string;
    email?: string; maxPapers?: number; maxTokens?: number; expiresAt?: string;
  }) {
    return this.adminService.createUser(body);
  }

  @Put("users/:id")
  @ApiOperation({ summary: "Edit user — quota, role, status, expiry" })
  async updateUser(
    @Param("id") id: string,
    @Body() body: { role?: string; isActive?: boolean; maxPapers?: number; maxTokens?: number; expiresAt?: string | null; displayName?: string },
  ) {
    return this.adminService.updateUser(id, body);
  }

  @Get("users/:id/usage")
  @ApiOperation({ summary: "Get user token usage details" })
  async getUserUsage(@Param("id") id: string) {
    return this.adminService.getUserUsage(id);
  }

  // ── Dashboard ──

  @Get("stats")
  @ApiOperation({ summary: "Dashboard statistics" })
  async getStats() {
    return this.adminService.getStats();
  }

  // ── Papers ──

  @Get("papers")
  @ApiOperation({ summary: "List all papers across all users" })
  async listAllPapers(@Query("page") page?: string, @Query("limit") limit?: string) {
    return this.adminService.listAllPapers(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  // ── Usage trends ──

  @Get("usage")
  @ApiOperation({ summary: "Token usage trends for last N days" })
  async getUsageTrends(@Query("days") days?: string) {
    return this.adminService.getUsageTrends(days ? parseInt(days, 10) : 30);
  }

  // ── User Service Management ──

  @Get("users/:userId/services")
  @ApiOperation({ summary: "List services for a specific user" })
  async listUserServices(@Param("userId") userId: string) {
    return this.servicesService.adminListByUser(userId);
  }

  @Post("users/:userId/services")
  @ApiOperation({ summary: "Create a service config for a user" })
  async createUserService(@Param("userId") userId: string, @Body() body: Record<string, unknown>) {
    return this.servicesService.adminCreateForUser(userId, body as any);
  }

  @Put("users/:userId/services/:svcId")
  @ApiOperation({ summary: "Update a user's service config" })
  async updateUserService(
    @Param("userId") userId: string,
    @Param("svcId") svcId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.servicesService.adminUpdateForUser(userId, svcId, body);
  }

  @Delete("users/:userId/services/:svcId")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete a user's service config" })
  async deleteUserService(@Param("userId") userId: string, @Param("svcId") svcId: string) {
    return this.servicesService.adminDeleteForUser(userId, svcId);
  }
}
