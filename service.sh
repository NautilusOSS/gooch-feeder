#!/bin/bash

# Gooch Feeder Service Management Script

SERVICE_NAME="gooch-feeder"
SERVICE_DIR="/Users/nicholasshellabarger/Desktop/repos/gooch-feeder"
PID_FILE="$SERVICE_DIR/gooch-feeder.pid"
LOG_FILE="$SERVICE_DIR/logs/gooch-feeder.log"

# Create logs directory if it doesn't exist
mkdir -p "$SERVICE_DIR/logs"

start() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p $PID > /dev/null 2>&1; then
            echo "Service $SERVICE_NAME is already running (PID: $PID)"
            return 1
        else
            rm -f "$PID_FILE"
        fi
    fi

    echo "Starting $SERVICE_NAME..."
    cd "$SERVICE_DIR"
    
    # Start the service in background
    nohup npm start > "$LOG_FILE" 2>&1 &
    PID=$!
    echo $PID > "$PID_FILE"
    
    echo "Service $SERVICE_NAME started (PID: $PID)"
    echo "Logs: $LOG_FILE"
}

stop() {
    if [ ! -f "$PID_FILE" ]; then
        echo "Service $SERVICE_NAME is not running"
        return 1
    fi

    PID=$(cat "$PID_FILE")
    if ! ps -p $PID > /dev/null 2>&1; then
        echo "Service $SERVICE_NAME is not running"
        rm -f "$PID_FILE"
        return 1
    fi

    echo "Stopping $SERVICE_NAME (PID: $PID)..."
    kill -TERM $PID
    
    # Wait for graceful shutdown
    for i in {1..30}; do
        if ! ps -p $PID > /dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    
    # Force kill if still running
    if ps -p $PID > /dev/null 2>&1; then
        echo "Force killing $SERVICE_NAME..."
        kill -KILL $PID
    fi
    
    rm -f "$PID_FILE"
    echo "Service $SERVICE_NAME stopped"
}

restart() {
    stop
    sleep 2
    start
}

status() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p $PID > /dev/null 2>&1; then
            echo "Service $SERVICE_NAME is running (PID: $PID)"
            return 0
        else
            echo "Service $SERVICE_NAME is not running (stale PID file)"
            rm -f "$PID_FILE"
            return 1
        fi
    else
        echo "Service $SERVICE_NAME is not running"
        return 1
    fi
}

logs() {
    if [ -f "$LOG_FILE" ]; then
        tail -f "$LOG_FILE"
    else
        echo "Log file not found: $LOG_FILE"
    fi
}

case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        status
        ;;
    logs)
        logs
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        exit 1
        ;;
esac
