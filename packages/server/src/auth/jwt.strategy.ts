import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "../config/redis.service.js";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private redis: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>("JWT_SECRET", "dev-secret"),
    });
  }

  async validate(payload: { sub: string; username: string; role: string; jti: string }) {
    const blacklisted = await this.redis.get(`blacklist:${payload.jti}`);
    if (blacklisted) throw new UnauthorizedException("Token revoked");
    return { sub: payload.sub, username: payload.username, role: payload.role, jti: payload.jti };
  }
}
