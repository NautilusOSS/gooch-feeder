import { Service } from '../types';
import { Logger } from '../utils/logger';
import { mnemonicToSecretKey } from 'algosdk';

export interface AccountInfo {
  address: string;
  mnemonic: string;
  secretKey: Uint8Array;
}

export class AccountService implements Service {
  public name = 'AccountService';
  private logger: Logger;
  private accountInfo: AccountInfo | null = null;

  constructor() {
    this.logger = new Logger('AccountService');
  }

  public async initialize(): Promise<void> {
    this.logger.info('Initializing Account Service...');
    
    try {
      // Load mnemonic from environment
      const mnemonic = this.loadMnemonicFromEnvironment();
      
      if (!mnemonic) {
        throw new Error('MNEMONIC environment variable is required but not set');
      }

      // Create account from mnemonic
      const accountData = this.createAccountFromMnemonic(mnemonic);
      
      this.accountInfo = {
        address: accountData.addr,
        mnemonic: mnemonic,
        secretKey: accountData.sk
      };

      this.logger.info(`Account initialized successfully`);
      this.logger.info(`Address: ${this.accountInfo.address}`);
      //this.logger.info(`Mnemonic loaded: ${mnemonic.split(' ').slice(0, 3).join(' ')}...`);
      
    } catch (error) {
      this.logger.error('Failed to initialize Account Service:', error instanceof Error ? error : String(error));
      throw error;
    }
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Shutting down Account Service...');
    
    // Clear sensitive data
    if (this.accountInfo) {
      this.accountInfo.mnemonic = '';
      this.accountInfo = null;
    }
    
    this.logger.info('Account Service shut down successfully');
  }

  public async isHealthy(): Promise<boolean> {
    try {
      return this.accountInfo !== null && this.accountInfo.address !== '';
    } catch (error) {
      this.logger.error('Account Service health check failed:', error instanceof Error ? error : String(error));
      return false;
    }
  }

  /**
   * Get the account secret key
   */
  public getSecretKey(): Uint8Array | null {
    return this.accountInfo?.secretKey || null;
  }

  /**
   * Get the account address
   */
  public getAddress(): string | null {
    return this.accountInfo?.address || null;
  }

  /**
   * Get the account mnemonic (use with caution - sensitive data)
   */
  public getMnemonic(): string | null {
    return this.accountInfo?.mnemonic || null;
  }

  /**
   * Get the full account info
   */
  public getAccountInfo(): AccountInfo | null {
    return this.accountInfo;
  }

  /**
   * Check if account is initialized
   */
  public isInitialized(): boolean {
    return this.accountInfo !== null;
  }

  /**
   * Load mnemonic from environment variables
   */
  private loadMnemonicFromEnvironment(): string | null {
    const mnemonic = process.env.MNEMONIC;
    
    if (!mnemonic) {
      this.logger.warn('MNEMONIC environment variable not found');
      return null;
    }

    // Basic validation - mnemonic should be 12, 24, or 25 words
    const words = mnemonic.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24 && words.length !== 25) {
      this.logger.error(`Invalid mnemonic length: ${words.length} words (expected 12, 24, or 25)`);
      return null;
    }

    this.logger.debug(`Loaded mnemonic with ${words.length} words`);
    return mnemonic;
  }

  /**
   * Create an account object from mnemonic
   */
  private createAccountFromMnemonic(mnemonic: string): { addr: string; sk: Uint8Array } {
    try {
      const accountData = mnemonicToSecretKey(mnemonic);
      this.logger.debug(`Created account from mnemonic: ${accountData.addr}`);
      return accountData;
    } catch (error) {
      this.logger.error('Failed to create account from mnemonic:', error instanceof Error ? error : String(error));
      throw new Error(`Invalid mnemonic: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate account balance and status (optional utility method)
   */
  public async validateAccount(): Promise<{ isValid: boolean; balance?: number; error?: string }> {
    try {
      if (!this.accountInfo) {
        return { isValid: false, error: 'Account not initialized' };
      }

      // This is a placeholder - you would implement actual balance checking here
      // using the Algorand client to query the account
      this.logger.debug('Account validation placeholder - implement actual balance checking');
      
      return { isValid: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Account validation failed:', errorMessage);
      return { isValid: false, error: errorMessage };
    }
  }
}
