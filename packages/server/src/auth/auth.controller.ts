import { Controller, Post, Body, HttpCode, HttpStatus, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from "@nestjs/swagger";
import { Request } from "express";
import { AuthService } from "./auth.service.js";
import { Public } from "../common/decorators/public.decorator.js";

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post("setup")
  @ApiOperation({ summary: "Initial setup — create first admin (only when no users exist)" })
  @ApiResponse({ status: 201, description: "Admin created" })
  @ApiResponse({ status: 409, description: "Setup already completed" })
  async setup(@Body() dto: { username: string; password: string }) {
    return this.authService.setup(dto);
  }

  @Public()
  @Post("register")
  @ApiOperation({ summary: "Register a new user" })
  @ApiResponse({ status: 201, description: "User registered" })
  async register(@Body() dto: { username: string; password: string; displayName?: string }) {
    return this.authService.register(dto);
  }

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Login with username and password" })
  @ApiResponse({ status: 200, description: "Returns access and refresh tokens" })
  async login(@Body() dto: { username: string; password: string }) {
    return this.authService.login(dto);
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Refresh access token using refresh token" })
  async refresh(@Body() dto: { refreshToken: string }) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Logout — blacklist access token and remove refresh token" })
  async logout(@Req() req: Request) {
    const authHeader = req.headers.authorization ?? "";
    const token = authHeader.replace("Bearer ", "");
    const userId = (req as any).user?.sub;
    await this.authService.logout(userId, token);
    return { message: "Logged out" };
  }
}
