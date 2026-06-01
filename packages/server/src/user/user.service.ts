import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import bcrypt from "bcryptjs";
import { User } from "../entities/user.entity.js";

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { username } });
  }

  async getProfile(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      quota: {
        maxPapers: user.maxPapers,
        papersCreated: user.papersCreated,
        maxTokens: user.maxTokens,
        tokensUsed: user.tokensUsed,
      },
      expiresAt: user.expiresAt,
      createdAt: user.createdAt,
    };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) throw new BadRequestException("Current password is incorrect");

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.userRepo.save(user);
    return { message: "Password updated" };
  }

  async incrementPapersCreated(userId: string): Promise<void> {
    await this.userRepo.increment({ id: userId }, "papersCreated", 1);
  }

  async addTokensUsed(userId: string, tokens: number): Promise<void> {
    await this.userRepo.increment({ id: userId }, "tokensUsed", tokens);
  }
}
