export interface Config {
  port: number;
  environment: string;
  logLevel: string;
  database?: {
    host: string;
    port: number;
    name: string;
    username?: string;
    password?: string;
  };
  api?: {
    baseUrl: string;
    timeout: number;
    retries: number;
  };
}

export const defaultConfig: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  environment: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'gooch_feeder',
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
  },
  api: {
    baseUrl: process.env.API_BASE_URL || 'https://api.example.com',
    timeout: parseInt(process.env.API_TIMEOUT || '30000', 10),
    retries: parseInt(process.env.API_RETRIES || '3', 10),
  },
};
