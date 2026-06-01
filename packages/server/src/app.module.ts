import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { AppBaseModule } from "./app/app.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { UserModule } from "./user/user.module.js";
import { PaperModule } from "./paper/paper.module.js";
import { ServicesModule } from "./services/services.module.js";
import { AdminModule } from "./admin/admin.module.js";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard.js";

@Module({
  imports: [
    EventEmitterModule.forRoot({ wildcard: true, delimiter: ":" }),
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [".env", ".env.local"] }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "mysql",
        host: config.get<string>("DB_HOST", "127.0.0.1"),
        port: config.get<number>("DB_PORT", 3306),
        username: config.get<string>("DB_USER", "root"),
        password: config.get<string>("DB_PASS", ""),
        database: config.get<string>("DB_NAME", "paper_writer"),
        autoLoadEntities: true,
        synchronize: true,
        logging: false,
      }),
    }),
    AppBaseModule,
    AuthModule,
    UserModule,
    PaperModule,
    ServicesModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
