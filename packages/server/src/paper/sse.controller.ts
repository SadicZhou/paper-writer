import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { JwtService } from "@nestjs/jwt";
import { Request, Response } from "express";
import { Public } from "../common/decorators/public.decorator.js";

@ApiTags("Events")
@Controller("events")
export class SseController {
  constructor(
    private eventEmitter: EventEmitter2,
    private jwtService: JwtService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "SSE stream for real-time pipeline events. Pass token as query param." })
  stream(@Query("token") token: string, @Req() req: Request, @Res() res: Response) {
    // Validate JWT from query parameter (EventSource doesn't support custom headers)
    if (!token) {
      res.status(401).json({ message: "Token query parameter required for SSE" });
      return;
    }
    try {
      this.jwtService.verify(token);
    } catch {
      res.status(401).json({ message: "Invalid SSE token" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Keep-alive ping every 30s
    const keepAlive = setInterval(() => {
      res.write(": ping\n\n");
    }, 30000);

    // onAny callback: (eventName, ...values)
    const handler = (eventName: string | string[], ...args: unknown[]) => {
      const name = Array.isArray(eventName) ? eventName.join(":") : eventName;
      const data = args.length === 1 ? args[0] : args;
      try {
        res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        clearInterval(keepAlive);
        this.eventEmitter.offAny(handler);
      }
    };

    this.eventEmitter.onAny(handler);

    req.on("close", () => {
      clearInterval(keepAlive);
      this.eventEmitter.offAny(handler);
    });
  }
}
