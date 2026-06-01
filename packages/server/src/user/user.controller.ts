import { Controller, Get, Put, Body, Req, HttpCode, HttpStatus } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from "@nestjs/swagger";
import { Request } from "express";
import { UserService } from "./user.service.js";

@ApiTags("Users")
@ApiBearerAuth()
@Controller("users")
export class UserController {
  constructor(private userService: UserService) {}

  @Get("me")
  @ApiOperation({ summary: "Get current user profile and quota" })
  async me(@Req() req: Request) {
    const userId = (req as any).user?.sub;
    return this.userService.getProfile(userId);
  }

  @Put("me/password")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Change current user password" })
  @ApiResponse({ status: 200, description: "Password updated" })
  async changePassword(
    @Req() req: Request,
    @Body() dto: { oldPassword: string; newPassword: string },
  ) {
    const userId = (req as any).user?.sub;
    return this.userService.changePassword(userId, dto.oldPassword, dto.newPassword);
  }
}
