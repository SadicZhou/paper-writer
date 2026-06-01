import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Paper } from "../entities/paper.entity.js";
import { PaperSectionEntity } from "../entities/paper-section.entity.js";
import { PaperOutlineEntity } from "../entities/paper-outline.entity.js";
import { PaperReferenceEntity } from "../entities/paper-reference.entity.js";
import { PaperInnovationEntity } from "../entities/paper-innovation.entity.js";
import { PipelineStateEntity } from "../entities/pipeline-state.entity.js";
import { UserModule } from "../user/user.module.js";
import { PaperService } from "./paper.service.js";
import { PaperController } from "./paper.controller.js";
import { SseController } from "./sse.controller.js";
import { DbStorageService } from "./db-storage.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([Paper, PaperSectionEntity, PaperOutlineEntity, PaperReferenceEntity, PaperInnovationEntity, PipelineStateEntity]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("JWT_SECRET", "dev-secret"),
      }),
    }),
    UserModule,
  ],
  controllers: [PaperController, SseController],
  providers: [PaperService, DbStorageService],
  exports: [PaperService],
})
export class PaperModule {}
