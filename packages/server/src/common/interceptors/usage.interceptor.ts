import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";

@Injectable()
export class UsageInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.sub;
    const paperId = request.params?.id;

    return next.handle().pipe(
      tap(() => {
        if (userId && paperId) {
          // Token usage will be recorded via UsageService injected into PaperService
        }
      }),
    );
  }
}
