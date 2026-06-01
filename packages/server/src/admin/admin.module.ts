import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "../entities/user.entity.js";
import { UsageRecord } from "../entities/usage-record.entity.js";
import { Paper } from "../entities/paper.entity.js";
import { ServiceConfig } from "../entities/service-config.entity.js";
import { ServicesModule } from "../services/services.module.js";
import { AdminService } from "./admin.service.js";
import { AdminController } from "./admin.controller.js";

@Module({
  imports: [TypeOrmModule.forFeature([User, UsageRecord, Paper, ServiceConfig]), ServicesModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
