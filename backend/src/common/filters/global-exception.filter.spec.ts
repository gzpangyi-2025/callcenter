import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GlobalExceptionFilter } from './global-exception.filter';

const createHost = () => {
  const status = jest.fn().mockReturnThis();
  const json = jest.fn();
  const response = { status, json } as unknown as Response;
  const request = { url: '/api/test' } as Request;
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as ArgumentsHost;

  return { host, status, json };
};

describe('GlobalExceptionFilter', () => {
  let loggerSpy: jest.SpiedFunction<Logger['error']>;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-09T12:00:00.000Z'));
    loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    loggerSpy.mockRestore();
    jest.useRealTimers();
  });

  it('formats class-validator style HttpException messages', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = createHost();

    filter.catch(
      new BadRequestException(['title is required', 'type is invalid']),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      code: HttpStatus.BAD_REQUEST,
      message: 'title is required, type is invalid',
      data: null,
      path: '/api/test',
      timestamp: '2026-05-09T12:00:00.000Z',
    });
  });

  it('falls back to the HttpException message when response is plain text', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = createHost();

    filter.catch(
      new HttpException('Forbidden area', HttpStatus.FORBIDDEN),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: HttpStatus.FORBIDDEN,
        message: 'Forbidden area',
      }),
    );
  });

  it('logs unexpected Error instances as internal server errors', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = createHost();

    filter.catch(new Error('database exploded'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'database exploded',
      }),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error processing request for /api/test:'),
    );
  });

  it('logs unknown thrown values and returns a generic message', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = createHost();

    filter.catch({ reason: 'not an Error' }, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      }),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      'Unknown error processing request for /api/test: {"reason":"not an Error"}',
    );
  });
});
