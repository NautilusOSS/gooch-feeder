import { ErrorContext } from './logger';

export interface ApiRequestInfo {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
}

export interface ApiResponseInfo {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: any;
}

export class ApiErrorHelper {
  /**
   * Creates error context from API request and response information
   */
  static createErrorContext(
    requestInfo: ApiRequestInfo,
    responseInfo?: ApiResponseInfo,
    additionalContext?: Partial<ErrorContext>
  ): ErrorContext {
    const context: ErrorContext = {
      uri: requestInfo.url,
      method: requestInfo.method || 'GET',
      requestHeaders: requestInfo.headers,
      requestBody: requestInfo.body,
      ...additionalContext
    };

    if (responseInfo) {
      context.statusCode = responseInfo.status;
      context.statusText = responseInfo.statusText;
      context.responseHeaders = responseInfo.headers;
      context.responseBody = responseInfo.body;
    }

    return context;
  }

  /**
   * Extracts error context from a fetch Response object
   */
  static async createErrorContextFromResponse(
    requestInfo: ApiRequestInfo,
    response: Response,
    additionalContext?: Partial<ErrorContext>
  ): Promise<ErrorContext> {
    let responseBody: any;
    
    try {
      // Try to get response body as text first
      const responseText = await response.text();
      try {
        // Try to parse as JSON
        responseBody = JSON.parse(responseText);
      } catch {
        // If not JSON, use as text
        responseBody = responseText;
      }
    } catch (error) {
      responseBody = 'Unable to read response body';
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return this.createErrorContext(
      requestInfo,
      {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseBody
      },
      additionalContext
    );
  }

  /**
   * Creates error context for network/connection errors
   */
  static createNetworkErrorContext(
    requestInfo: ApiRequestInfo,
    error: Error,
    additionalContext?: Partial<ErrorContext>
  ): ErrorContext {
    return this.createErrorContext(
      requestInfo,
      undefined,
      {
        ...additionalContext,
        // Add error message as response body for network errors
        responseBody: error.message
      }
    );
  }

  /**
   * Creates error context for timeout errors
   */
  static createTimeoutErrorContext(
    requestInfo: ApiRequestInfo,
    timeout: number,
    additionalContext?: Partial<ErrorContext>
  ): ErrorContext {
    return this.createErrorContext(
      requestInfo,
      undefined,
      {
        ...additionalContext,
        statusCode: 408,
        statusText: 'Request Timeout',
        responseBody: `Request timed out after ${timeout}ms`
      }
    );
  }

  /**
   * Sanitizes sensitive information from request/response data
   */
  static sanitizeContext(context: ErrorContext): ErrorContext {
    const sanitized = { ...context };

    // Remove sensitive headers
    if (sanitized.requestHeaders) {
      sanitized.requestHeaders = this.sanitizeHeaders(sanitized.requestHeaders);
    }

    if (sanitized.responseHeaders) {
      sanitized.responseHeaders = this.sanitizeHeaders(sanitized.responseHeaders);
    }

    // Sanitize request/response bodies (remove sensitive fields)
    if (sanitized.requestBody) {
      sanitized.requestBody = this.sanitizeBody(sanitized.requestBody);
    }

    if (sanitized.responseBody) {
      sanitized.responseBody = this.sanitizeBody(sanitized.responseBody);
    }

    return sanitized;
  }

  private static sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sensitiveHeaders = ['authorization', 'x-api-key', 'x-auth-token', 'cookie'];
    const sanitized = { ...headers };

    for (const header of sensitiveHeaders) {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  private static sanitizeBody(body: any): any {
    if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        return this.sanitizeObject(parsed);
      } catch {
        return body;
      }
    }

    if (typeof body === 'object' && body !== null) {
      return this.sanitizeObject(body);
    }

    return body;
  }

  private static sanitizeObject(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    if (typeof obj === 'object' && obj !== null) {
      const sanitized: any = {};
      const sensitiveFields = ['password', 'token', 'key', 'secret', 'auth'];

      for (const [key, value] of Object.entries(obj)) {
        const isSensitive = sensitiveFields.some(field => 
          key.toLowerCase().includes(field)
        );

        if (isSensitive) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitizeObject(value);
        }
      }

      return sanitized;
    }

    return obj;
  }
}
