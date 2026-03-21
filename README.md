# Gooch Feeder

A TypeScript background service for data feeding and processing.

## Features

- 🚀 TypeScript-based background service
- 📦 Modular service architecture
- 🔧 Configurable via environment variables
- 📊 Built-in logging and health monitoring
- 🛡️ Graceful shutdown handling
- 🔄 Service management system
- 🌐 Network configuration management
- 📡 Multi-network monitoring and health checks
- 💰 Price feeder system with multiple sources
- 🔗 Price oracle integration
- 📈 Real-time price monitoring and posting
- 🔔 Optional Discord webhook alerts on feeder failures
- 💸 Optional Discord alerts when signer balance is low on Algorand and Voi

## Project Structure

```
gooch-feeder/
├── config/
│   ├── networks.json   # Network configurations
│   ├── networks/       # Detailed network configs
│   │   └── voi-mainnet.json
│   └── feeders.json    # Price feeder configurations
├── src/
│   ├── config/          # Configuration files
│   ├── services/        # Service implementations
│   │   ├── feeder-manager-service.ts
│   │   ├── price-lookup-service.ts
│   │   ├── price-oracle-service.ts
│   │   ├── network-monitoring-service.ts
│   │   └── price-feed-service.ts
│   ├── types/          # TypeScript type definitions
│   ├── utils/          # Utility functions
│   └── index.ts        # Main entry point
├── dist/               # Compiled JavaScript output
├── package.json        # Dependencies and scripts
├── tsconfig.json       # TypeScript configuration
├── .eslintrc.json      # ESLint configuration
└── README.md           # This file
```

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd gooch-feeder
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment configuration:
```bash
cp env.example .env
```

4. Configure network settings:
```bash
# Edit the network configuration file
nano config/networks.json
```

5. Edit `.env` file with your configuration:
```bash
# Environment variables
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Database configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gooch_feeder
DB_USERNAME=your_username
DB_PASSWORD=your_password

# API configuration
API_BASE_URL=https://api.example.com
API_TIMEOUT=30000
API_RETRIES=3
```

### Development

Run the service in development mode:
```bash
npm run dev
```

Build the project:
```bash
npm run build
```

Run the compiled service:
```bash
npm start
```

### Available Scripts

- `npm run dev` - Run in development mode with ts-node
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run the compiled service
- `npm run watch` - Watch for changes and recompile
- `npm run clean` - Remove dist directory
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues

### Service Management Scripts

- `npm run service:start` - Start service in background
- `npm run service:stop` - Stop background service
- `npm run service:restart` - Restart background service
- `npm run service:status` - Check service status
- `npm run service:logs` - View service logs

### PM2 Process Manager Scripts (Recommended for Production)

- `npm run pm2:start` - Start with PM2 process manager
- `npm run pm2:stop` - Stop PM2 process
- `npm run pm2:restart` - Restart PM2 process
- `npm run pm2:delete` - Remove PM2 process
- `npm run pm2:logs` - View PM2 logs
- `npm run pm2:status` - Check PM2 status

## Service Architecture

The service uses a modular architecture with the following components:

### Service Manager
Manages the lifecycle of all services, including initialization, health checks, and graceful shutdown.

### Logger
Provides structured logging with timestamps and service identification.

### Configuration
Centralized configuration management using environment variables.

## Adding New Services

To add a new service, implement the `Service` interface:

```typescript
import { Service } from './types';

export class MyService implements Service {
  name = 'MyService';

  async initialize(): Promise<void> {
    // Initialize your service
  }

  async shutdown(): Promise<void> {
    // Cleanup resources
  }

  async isHealthy(): Promise<boolean> {
    // Return health status
    return true;
  }
}
```

Then register it with the service manager in `src/index.ts`.

## Network Configuration

The service supports two types of network configurations:

### 1. Basic Network Configuration (`config/networks.json`)

Contains basic network settings:
- **Network definitions**: RPC URLs, WebSocket URLs, chain IDs, explorer URLs
- **Default network**: Primary network to use
- **Fallback networks**: Backup networks if primary fails
- **Global settings**: Request limits, timeouts, health check intervals

### 2. Detailed Network Configuration (`config/networks/` directory)

Contains comprehensive network-specific data:
- **Token configurations**: Contract addresses, decimals, symbols
- **Contract addresses**: Price oracle, lending pools, market controller
- **Asset prices**: Current prices with timestamps
- **PreFi parameters**: Collateral factors, liquidation thresholds
- **Contract state**: Global state and metadata

### Example Basic Configuration

```json
{
  "networks": {
    "voiMainnet": {
      "name": "VOI Mainnet",
      "chainId": 0,
      "rpcUrl": "https://mainnet-api.voi.nodely.dev",
      "wsUrl": "wss://mainnet-api.voi.nodely.dev",
      "explorerUrl": "https://voi.observer",
      "enabled": true,
      "timeout": 30000,
      "retries": 3
    }
  },
  "defaultNetwork": "voiMainnet",
  "fallbackNetworks": ["mainnet", "polygon"],
  "globalSettings": {
    "maxConcurrentRequests": 10,
    "requestDelay": 1000,
    "healthCheckInterval": 60000,
    "circuitBreakerThreshold": 5,
    "circuitBreakerTimeout": 300000
  },
  "detailedNetworksDir": "config/networks"
}
```

### Example Detailed Network Configuration (`config/networks/voiMainnet.json`)

```json
{
  "metadata": {
    "network": "voi-mainnet",
    "contractId": "46826662",
    "isDeployed": true
  },
  "networkConfig": {
    "networkId": "voi-mainnet",
    "name": "VOI Mainnet",
    "rpcUrl": "https://mainnet-api.voi.nodely.dev",
    "contracts": {
      "priceOracle": "46826662",
      "lendingPools": ["46505156"]
    },
    "tokens": {
      "VOI": {
        "contractId": "46504436",
        "decimals": 6,
        "symbol": "VOI"
      }
    }
  },
  "assetPrices": {
    "voi": {
      "symbol": "VOI",
      "price": 0.5,
      "lastUpdated": "2025-10-22T01:23:58.000Z"
    }
  }
}
```

### Network Health Monitoring

The service automatically monitors network health and tracks:
- Response times
- Error counts
- Last check timestamps
- Circuit breaker status

## Price Feeder System

The service includes a comprehensive price feeder system that can fetch prices from multiple sources and post them to price oracles.

### Feeder Configuration (`config/feeders.json`)

Each feeder is configured with:
- **ID**: Format `network-poolid-marketid` (e.g., `voi-mainnet-46505156-VOI`)
- **Method**: `fetch`, `post`, or `fetch-and-post`
- **Source**: API, RPC, WebSocket, or smart contract
- **Destination**: Price oracle contract, database, or API
- **Validation**: Price limits, change thresholds, required fields
- **Fallback**: Alternative sources if primary fails

### Example Feeder Configuration

```json
{
  "feeders": {
    "voi-mainnet-46505156-VOI": {
      "id": "voi-mainnet-46505156-VOI",
      "method": "fetch-and-post",
      "networkId": "voi-mainnet",
      "poolId": "46505156",
      "marketId": "VOI",
      "assetSymbol": "VOI",
      "enabled": true,
      "interval": 30000,
      "timeout": 10000,
      "retries": 3,
      "priority": 10,
      "source": {
        "type": "api",
        "url": "https://api.coingecko.com/api/v3/simple/price",
        "params": {
          "ids": "voi-network",
          "vs_currencies": "usd"
        }
      },
      "destination": {
        "type": "price-oracle",
        "contractAddress": "46826662",
        "functionName": "updatePrice"
      },
      "validation": {
        "minPrice": 0.01,
        "maxPrice": 1000,
        "maxPriceChange": 50
      }
    }
  }
}
```

### Supported Price Sources

- **VOI Rewards API**: Real-time VOI market data from multiple exchanges
- **CoinGecko API**: Real-time cryptocurrency prices
- **Binance API**: Exchange prices
- **RPC Calls**: Direct blockchain queries
- **WebSocket**: Real-time price streams
- **Smart Contracts**: On-chain price feeds

### VOI Rewards API Integration

The service integrates with the [VOI Rewards API](https://voirewards.com/api/markets?token=VOI) to fetch real-time VOI prices from multiple exchanges:

- **Nomadex**: Primary VOI network DEX
- **Tinyman**: Algorand DEX
- **PactFi**: Algorand DEX
- **Uniswap**: Base network
- **Humble**: VOI network DEX

The system uses the **weighted average price** from the aggregates data, which provides a more stable and representative price across all exchanges. If the weighted average is unavailable, it falls back to selecting the best price based on trading volume and exchange priority.

### Rate Limiting & Reliability

- **Request Throttling**: 2-second minimum interval between API requests
- **Staggered Feeder Starts**: 5-second delays between feeder initialization
- **Exponential Backoff**: Smart retry logic with jitter for rate limit errors
- **Rate Limit Detection**: Automatic detection of 429 errors and appropriate backoff
- **Fallback Sources**: Multiple price sources for redundancy
- **Configurable Intervals**: 60-second primary intervals, 120-second fallback intervals

## Keeping the Service Running

The service is designed to run continuously as a background process. Here are several ways to keep it running:

### 1. Development Mode (Foreground)
```bash
npm run dev
```
This runs the service in the foreground for development. Press `Ctrl+C` to stop.

### 2. Background Service Script
```bash
# Start in background
npm run service:start

# Check status
npm run service:status

# View logs
npm run service:logs

# Stop service
npm run service:stop
```

### 3. PM2 Process Manager (Recommended for Production)
First install PM2 globally:
```bash
npm install -g pm2
```

Then use PM2 commands:
```bash
# Start with PM2
npm run pm2:start

# Check status
npm run pm2:status

# View logs
npm run pm2:logs

# Stop
npm run pm2:stop
```

### 4. System Service (Linux/macOS)
Create a systemd service file or use launchd on macOS for automatic startup.

### 5. Docker Container
Run the service in a Docker container for isolation and easy deployment.

## Service Features

- **Heartbeat Monitoring**: Logs every minute to confirm service is running
- **Background Tasks**: Runs periodic tasks every 30 seconds (configurable)
- **Graceful Shutdown**: Handles SIGINT/SIGTERM signals properly
- **Error Handling**: Catches uncaught exceptions and unhandled rejections
- **Process Management**: PID file tracking and status monitoring

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `PORT` | Service port | `3000` |
| `LOG_LEVEL` | Logging level | `info` |
| `DB_HOST` | Database host | `localhost` |
| `DB_PORT` | Database port | `5432` |
| `DB_NAME` | Database name | `gooch_feeder` |
| `API_BASE_URL` | API base URL | `https://api.example.com` |
| `API_TIMEOUT` | API timeout (ms) | `30000` |
| `API_RETRIES` | API retry count | `3` |
| `DISCORD_WEBHOOK_URL` | Discord incoming webhook URL for failure notifications | _(unset = disabled)_ |
| `DISCORD_MIN_INTERVAL_MS` | Min ms between Discord alerts per feeder (anti-spam) | `60000` (`0` = no throttle) |
| `DISCORD_NOTIFY_ON_CLI` | Send Discord alerts from `npm run test:feeder` / `test:all-feeders` | `false` |
| `DISCORD_NOTIFY_ON_STARTUP` | One Discord message when the service starts (feeder counts, mode) | `true` |
| `DISCORD_NOTIFY_BALANCE` | Discord when signer balance is low on Algorand + Voi mainnets | `true` |
| `DISCORD_BALANCE_THRESHOLD_MICRO` | Low-balance threshold in micro-units (5e6 = 5 ALGO / 5 VOI) | `5000000` |
| `DISCORD_BALANCE_CHECK_INTERVAL_MS` | How often to poll balances | `900000` (15 min) |
| `DISCORD_BALANCE_MIN_INTERVAL_MS` | Min time between Discord low-balance alerts per network | `3600000` (1 h) |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

MIT License - see LICENSE file for details.
