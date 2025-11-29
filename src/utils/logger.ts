export interface ErrorContext {
  uri?: string;
  method?: string;
  statusCode?: number;
  statusText?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: any;
  responseBody?: any;
  duration?: number;
  retryAttempt?: number;
  networkId?: string;
  assetSymbol?: string;
}

export class Logger {
  private serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  private formatMessage(level: string, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] [${this.serviceName}] ${message}`;
  }

  private formatErrorContext(context: ErrorContext): string {
    const parts: string[] = [];
    
    if (context.uri) {
      parts.push(`URI: ${context.uri}`);
    }
    
    if (context.method) {
      parts.push(`Method: ${context.method}`);
    }
    
    if (context.statusCode) {
      parts.push(`Status: ${context.statusCode}`);
    }
    
    if (context.statusText) {
      parts.push(`Status Text: ${context.statusText}`);
    }
    
    if (context.duration !== undefined) {
      parts.push(`Duration: ${context.duration}ms`);
    }
    
    if (context.retryAttempt !== undefined) {
      parts.push(`Retry Attempt: ${context.retryAttempt}`);
    }
    
    if (context.networkId) {
      parts.push(`Network: ${context.networkId}`);
    }
    
    if (context.assetSymbol) {
      parts.push(`Asset: ${context.assetSymbol}`);
    }
    
    if (context.requestHeaders && Object.keys(context.requestHeaders).length > 0) {
      parts.push(`Request Headers: ${JSON.stringify(context.requestHeaders)}`);
    }
    
    if (context.responseHeaders && Object.keys(context.responseHeaders).length > 0) {
      parts.push(`Response Headers: ${JSON.stringify(context.responseHeaders)}`);
    }
    
    if (context.requestBody) {
      parts.push(`Request Body: ${JSON.stringify(context.requestBody)}`);
    }
    
    if (context.responseBody) {
      parts.push(`Response Body: ${JSON.stringify(context.responseBody)}`);
    }
    
    return parts.length > 0 ? ` | ${parts.join(' | ')}` : '';
  }

  public info(message: string, ...args: any[]): void {
    console.log(this.formatMessage('INFO', message), ...args);
  }

  public warn(message: string, ...args: any[]): void {
    console.warn(this.formatMessage('WARN', message), ...args);
  }

  public error(message: string, error?: Error | string, context?: ErrorContext, ...additionalArgs: any[]): void {
    let errorMessage = message;
    
    if (error) {
      if (error instanceof Error) {
        errorMessage += ` | Error: ${error.message}`;
        if (error.stack) {
          errorMessage += ` | Stack: ${error.stack}`;
        }
      } else {
        errorMessage += ` | Error: ${error}`;
      }
    }
    
    if (context) {
      errorMessage += this.formatErrorContext(context);
    }
    
    // Add any additional arguments
    if (additionalArgs.length > 0) {
      errorMessage += ` | ${additionalArgs.join(' | ')}`;
    }
    
    console.error(this.formatMessage('ERROR', errorMessage));
  }

  public debug(message: string, ...args: any[]): void {
    if (process.env.NODE_ENV === 'development') {
      console.debug(this.formatMessage('DEBUG', message), ...args);
    }
  }
}
