#!/bin/bash

# eIquidus graceful reload wrapper
# Usage: systemctl reload elquidus.service

# Find the cluster master PID
CLUSTER_PID=$(pgrep -f "node --stack-size.*bin/cluster" | head -1)

if [ -z "$CLUSTER_PID" ]; then
    echo "Error: Cluster process not found"
    exit 1
fi

echo "Sending reload signal to cluster (PID: $CLUSTER_PID)"
kill -HUP "$CLUSTER_PID"

if [ $? -eq 0 ]; then
    echo "✓ Reload signal sent successfully"
    exit 0
else
    echo "✗ Failed to send reload signal"
    exit 1
fi
