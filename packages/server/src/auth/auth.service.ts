import { Injectable, UnauthorizedException, ConflictException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { User } from "../entities/user.entity.js";
import { RedisService } from "../config/redis.service.js";

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private jwtService: JwtService,
    private redis: RedisService,
  ) {}

  async register(dto: { username: string; password: string; displayName?: string }) {
    const existing = await this.userRepo.findOne({ where: { username: dto.username } });
    if (existing) throw new ConflictException("Username already exists");

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      username: dto.username,
      passwordHash,
      displayName: dto.displayName,
      role: "user",
    });
    await this.userRepo.save(user);
    return { id: user.id, username: user.username };
  }

  async login(dto: { username: string; password: string }) {
    const user = await this.validateUser(dto.username, dto.password);
    return this.generateTokens(user);
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; username: string; role: string };
    try {
      payload = this.jwtService.verify(refreshToken, { ignoreExpiration: false });
    } catch {
      throw new UnauthorizedException("Invalid refresh token");
    }

    const stored = await this.redis.get(`refresh_token:${payload.sub}`);
    if (!stored || stored !== refreshToken) {
      throw new UnauthorizedException("Refresh token revoked");
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw new UnauthorizedException("User not active");

    return this.generateTokens(user);
  }

  async logout(userId: string, accessToken: string) {
    const decoded = this.jwtService.decode(accessToken) as { exp: number; jti: string } | null;
    if (decoded?.jti) {
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await this.redis.set(`blacklist:${decoded.jti}`, "1", ttl);
      }
    }
    await this.redis.del(`refresh_token:${userId}`);
  }

  async setup(dto: { username: string; password: string }) {
    const count = await this.userRepo.count();
    if (count > 0) throw new ConflictException("Setup already completed");
    return this.userRepo.manager.transaction(async (mgr) => {
      const passwordHash = await bcrypt.hash(dto.password, 10);
      const user = mgr.create(User, {
        username: dto.username,
        passwordHash,
        role: "admin",
        maxPapers: 999,
        maxTokens: 999999999,
      });
      await mgr.save(user);
      return { id: user.id, username: user.username, role: user.role };
    });
  }

  async validateUser(username: string, password: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { username } });
    if (!user) throw new UnauthorizedException("Invalid credentials");
    if (!user.isActive) throw new UnauthorizedException("Account disabled");
    if (user.expiresAt && new Date() > user.expiresAt) {
      throw new UnauthorizedException("Account expired");
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException("Invalid credentials");
    return user;
  }

  private async generateTokens(user: User) {
    const jti = uuid();
    const payload = { sub: user.id, username: user.username, role: user.role, jti };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, { expiresIn: "30d" });
    await this.redis.set(`refresh_token:${user.id}`, refreshToken, 30 * 24 * 3600);
    return { accessToken, refreshToken, user: { id: user.id, username: user.username, role: user.role } };
  }
}
