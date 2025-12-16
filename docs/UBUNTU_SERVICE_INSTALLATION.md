# Installing Gooch Feeder as a System Service on Ubuntu

This guide will walk you through installing Gooch Feeder as a systemd service on Ubuntu, allowing it to run automatically on boot and be managed using standard system service commands.

## Prerequisites

- Ubuntu 18.04 or later
- Node.js (v16 or higher) and npm installed
- Root or sudo access
- The Gooch Feeder application installed and configured

## Step 1: Install Node.js (if not already installed)

```bash
# Update package list
sudo apt update

# Install Node.js using NodeSource repository (recommended for latest LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version
```

Alternatively, you can use the default Ubuntu repository:
```bash
sudo apt update
sudo apt install -y nodejs npm
```

## Step 2: Install and Configure Gooch Feeder

1. **Clone or copy the repository** to your desired location (e.g., `/opt/gooch-feeder` or `/home/username/gooch-feeder`):

```bash
# Example: Install to /opt/gooch-feeder
sudo mkdir -p /opt
sudo chown $USER:$USER /opt/gooch-feeder
# Then clone/copy your repository to /opt/gooch-feeder
```

2. **Install dependencies**:

```bash
cd /opt/gooch-feeder
npm install
```

3. **Build the project**:

```bash
npm run build
```

4. **Configure environment variables**:

```bash
cp env.example .env
nano .env
```

Edit the `.env` file with your configuration, especially:
- `MNEMONIC`: Your wallet mnemonic phrase (required)
- `NODE_ENV`: Set to `production` for production use
- `LOG_LEVEL`: Set to `info` or `warn` for production

5. **Configure network and feeder settings**:

Edit the configuration files as needed:
- `config/networks.json`
- `config/networks/*.json`
- `config/feeders.json`

## Step 3: Create a System User (Recommended)

For security, it's recommended to run the service as a dedicated non-root user:

```bash
sudo useradd -r -s /bin/false -d /opt/gooch-feeder gooch-feeder
sudo chown -R gooch-feeder:gooch-feeder /opt/gooch-feeder
```

If you prefer to run as your own user, skip this step.

## Step 4: Create the Systemd Service File

Create a systemd service file:

```bash
sudo nano /etc/systemd/system/gooch-feeder.service
```

Add the following content (adjust paths and user as needed):

```ini
[Unit]
Description=Gooch Feeder Service
After=network.target

[Service]
Type=simple
User=gooch-feeder
Group=gooch-feeder
WorkingDirectory=/opt/gooch-feeder
Environment=NODE_ENV=production
EnvironmentFile=/opt/gooch-feeder/.env
ExecStart=/usr/bin/node /opt/gooch-feeder/dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=gooch-feeder

# Security settings
NoNewPrivileges=true
PrivateTmp=true

# Resource limits (adjust as needed)
LimitNOFILE=65536
MemoryMax=2G

[Install]
WantedBy=multi-user.target
```

**Important Configuration Notes:**

- **User/Group**: Change `gooch-feeder` to your username if not using a dedicated user
- **WorkingDirectory**: Update to match your installation path
- **EnvironmentFile**: Points to your `.env` file location
- **ExecStart**: Uses the compiled JavaScript from `dist/index.js`
- **Restart**: Automatically restarts the service if it crashes
- **RestartSec**: Waits 10 seconds before restarting

## Step 5: Set Permissions

Ensure the service user (or your user) has proper permissions:

```bash
# If using dedicated user
sudo chown -R gooch-feeder:gooch-feeder /opt/gooch-feeder
sudo chmod 600 /opt/gooch-feeder/.env  # Protect .env file

# If using your own user, ensure you own the directory
sudo chown -R $USER:$USER /opt/gooch-feeder
```

## Step 6: Enable and Start the Service

1. **Reload systemd** to recognize the new service:

```bash
sudo systemctl daemon-reload
```

2. **Enable the service** to start on boot:

```bash
sudo systemctl enable gooch-feeder.service
```

3. **Start the service**:

```bash
sudo systemctl start gooch-feeder.service
```

4. **Check the status**:

```bash
sudo systemctl status gooch-feeder.service
```

You should see output indicating the service is active and running.

## Step 7: Verify the Service

1. **Check service status**:

```bash
sudo systemctl status gooch-feeder.service
```

2. **View service logs**:

```bash
# View recent logs
sudo journalctl -u gooch-feeder.service -n 50

# Follow logs in real-time
sudo journalctl -u gooch-feeder.service -f

# View logs since boot
sudo journalctl -u gooch-feeder.service -b

# View logs from a specific time
sudo journalctl -u gooch-feeder.service --since "1 hour ago"
```

3. **Check application logs** (if configured):

```bash
tail -f /opt/gooch-feeder/logs/gooch-feeder.log
```

## Managing the Service

### Start the service:
```bash
sudo systemctl start gooch-feeder.service
```

### Stop the service:
```bash
sudo systemctl stop gooch-feeder.service
```

### Restart the service:
```bash
sudo systemctl restart gooch-feeder.service
```

### Reload configuration (if service file changed):
```bash
sudo systemctl daemon-reload
sudo systemctl restart gooch-feeder.service
```

### Check service status:
```bash
sudo systemctl status gooch-feeder.service
```

### Disable auto-start on boot:
```bash
sudo systemctl disable gooch-feeder.service
```

### Enable auto-start on boot:
```bash
sudo systemctl enable gooch-feeder.service
```

## Troubleshooting

### Service fails to start

1. **Check service status**:
```bash
sudo systemctl status gooch-feeder.service
```

2. **Check logs**:
```bash
sudo journalctl -u gooch-feeder.service -n 100
```

3. **Verify paths and permissions**:
```bash
# Check if the dist directory exists and has the compiled files
ls -la /opt/gooch-feeder/dist/

# Check if .env file exists and has correct permissions
ls -la /opt/gooch-feeder/.env

# Verify Node.js is in the expected location
which node
```

4. **Test manual execution**:
```bash
# Switch to the service user (or your user)
sudo -u gooch-feeder bash
cd /opt/gooch-feeder
node dist/index.js
```

### Service keeps restarting

1. **Check logs for errors**:
```bash
sudo journalctl -u gooch-feeder.service -n 100 --no-pager
```

2. **Check if port is already in use**:
```bash
sudo netstat -tulpn | grep :3000
```

3. **Verify environment variables**:
```bash
sudo -u gooch-feeder cat /opt/gooch-feeder/.env
```

### Permission issues

1. **Ensure service user owns the directory**:
```bash
sudo chown -R gooch-feeder:gooch-feeder /opt/gooch-feeder
```

2. **Check file permissions**:
```bash
ls -la /opt/gooch-feeder
```

3. **Verify .env file is readable**:
```bash
sudo -u gooch-feeder cat /opt/gooch-feeder/.env
```

### Build issues

If you need to rebuild after code changes:

```bash
cd /opt/gooch-feeder
npm run build
sudo systemctl restart gooch-feeder.service
```

## Alternative: Using PM2 with systemd

If you prefer to use PM2 for process management, you can create a systemd service that starts PM2:

1. **Install PM2 globally**:
```bash
sudo npm install -g pm2
```

2. **Create PM2 startup script**:
```bash
pm2 startup systemd
```

3. **Start the service with PM2**:
```bash
cd /opt/gooch-feeder
pm2 start ecosystem.config.js --env production
pm2 save
```

4. **Create a systemd service** (PM2 will provide the command during `pm2 startup`):

The PM2 startup command will generate a systemd service file automatically. Follow the instructions provided by the `pm2 startup` command.

## Security Considerations

1. **File Permissions**: Ensure `.env` file is readable only by the service user:
```bash
sudo chmod 600 /opt/gooch-feeder/.env
sudo chown gooch-feeder:gooch-feeder /opt/gooch-feeder/.env
```

2. **Firewall**: If the service exposes ports, configure UFW:
```bash
sudo ufw allow 3000/tcp  # Only if needed
```

3. **Log Rotation**: Configure log rotation to prevent disk space issues:
```bash
sudo nano /etc/logrotate.d/gooch-feeder
```

Add:
```
/opt/gooch-feeder/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 gooch-feeder gooch-feeder
}
```

## Updating the Service

When updating the application:

1. **Stop the service**:
```bash
sudo systemctl stop gooch-feeder.service
```

2. **Update the code** (pull from git, etc.):
```bash
cd /opt/gooch-feeder
git pull  # or copy new files
```

3. **Install new dependencies** (if needed):
```bash
npm install
```

4. **Rebuild**:
```bash
npm run build
```

5. **Start the service**:
```bash
sudo systemctl start gooch-feeder.service
```

## Monitoring

### Check if service is running:
```bash
sudo systemctl is-active gooch-feeder.service
```

### View resource usage:
```bash
systemctl status gooch-feeder.service
```

### Monitor logs continuously:
```bash
sudo journalctl -u gooch-feeder.service -f
```

## Uninstalling

To remove the service:

1. **Stop and disable the service**:
```bash
sudo systemctl stop gooch-feeder.service
sudo systemctl disable gooch-feeder.service
```

2. **Remove the service file**:
```bash
sudo rm /etc/systemd/system/gooch-feeder.service
```

3. **Reload systemd**:
```bash
sudo systemctl daemon-reload
```

4. **Remove the application** (optional):
```bash
sudo rm -rf /opt/gooch-feeder
```

5. **Remove the service user** (if created):
```bash
sudo userdel gooch-feeder
```

