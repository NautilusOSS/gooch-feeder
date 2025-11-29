import { Logger } from '../utils/logger';

export interface Service {
  name: string;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  isHealthy(): Promise<boolean>;
}

export class ServiceManager {
  private logger: Logger;
  private services: Map<string, Service> = new Map();

  constructor() {
    this.logger = new Logger('ServiceManager');
  }

  public registerService(service: Service): void {
    this.services.set(service.name, service);
    this.logger.info(`Registered service: ${service.name}`);
  }

  public async initialize(): Promise<void> {
    this.logger.info('Initializing all services...');
    
    for (const [name, service] of this.services) {
      try {
        this.logger.info(`Initializing service: ${name}`);
        await service.initialize();
        this.logger.info(`Service ${name} initialized successfully`);
      } catch (error) {
        this.logger.error(`Failed to initialize service ${name}:`, error instanceof Error ? error : String(error));
        throw error;
      }
    }
    
    this.logger.info('All services initialized successfully');
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Shutting down all services...');
    
    const shutdownPromises = Array.from(this.services.values()).map(async (service) => {
      try {
        this.logger.info(`Shutting down service: ${service.name}`);
        await service.shutdown();
        this.logger.info(`Service ${service.name} shut down successfully`);
      } catch (error) {
        this.logger.error(`Error shutting down service ${service.name}:`, error instanceof Error ? error : String(error));
      }
    });

    await Promise.all(shutdownPromises);
    this.logger.info('All services shut down');
  }

  public async healthCheck(): Promise<Record<string, boolean>> {
    const healthStatus: Record<string, boolean> = {};
    
    for (const [name, service] of this.services) {
      try {
        healthStatus[name] = await service.isHealthy();
      } catch (error) {
        this.logger.error(`Health check failed for service ${name}:`, error instanceof Error ? error : String(error));
        healthStatus[name] = false;
      }
    }
    
    return healthStatus;
  }

  public getService<T extends Service>(name: string): T | undefined {
    return this.services.get(name) as T | undefined;
  }
}
