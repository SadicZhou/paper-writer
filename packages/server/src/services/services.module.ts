import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ServiceConfig } from "../entities/service-config.entity.js";
import { ServicesService } from "./services.service.js";
import { ServicesController } from "./services.controller.js";

@Module({
  imports: [TypeOrmModule.forFeature([ServiceConfig])],
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
