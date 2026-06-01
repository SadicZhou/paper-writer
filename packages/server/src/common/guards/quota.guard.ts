import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { UserService } from "../../user/user.service.js";

@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(private userService: UserService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.sub;
    if (!userId) return true;

    const user = await this.userService.findById(userId);
    if (!user) throw new HttpException("User not found", HttpStatus.UNAUTHORIZED);
    if (!user.isActive) throw new HttpException("Account disabled", HttpStatus.FORBIDDEN);
    if (user.expiresAt && new Date() > user.expiresAt) {
      throw new HttpException("Account expired", HttpStatus.FORBIDDEN);
    }
    if (user.papersCreated >= user.maxPapers) {
      throw new HttpException("Paper quota exceeded", HttpStatus.TOO_MANY_REQUESTS);
    }
    if (user.tokensUsed >= user.maxTokens) {
      throw new HttpException("Token quota exceeded", HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
