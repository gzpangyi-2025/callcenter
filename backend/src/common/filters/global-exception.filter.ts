import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      // Handle class-validator messages which might be an array
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null && 'message' in exceptionResponse) {
        const msg = (exceptionResponse as any).message;
        message = Array.isArray(msg) ? msg.join(', ') : msg;
      } else {
        message = exception.message || 'Error occurred';
      }
    } else if (exception instanceof Error) {
      status = (exception as any).status || HttpStatus.INTERNAL_SERVER_ERROR;
      message = exception.message;
      // Log the full stack trace for internal server errors
      if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(`Error processing request for ${request.url}: ${exception.stack}`);
      }
    } else {
      this.logger.error(`Unknown error processing request for ${request.url}: ${JSON.stringify(exception)}`);
    }

    // Format the standard response structure
    response.status(status).json({
      code: status,
      message: message,
      data: null,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
