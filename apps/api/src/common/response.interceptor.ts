import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface ApiResponse<T> {
  code: string;
  message: string;
  data: T;
  requestId: string;
}

/** 统一响应包：{ code, message, data, requestId } */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    const req = context.switchToHttp().getRequest();
    return next.handle().pipe(
      map((data) => ({
        code: 'OK',
        message: '',
        data,
        requestId: req.requestId ?? '',
      })),
    );
  }
}
