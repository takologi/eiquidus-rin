#!/usr/bin/env node

/**
 * Graceful reload script for eIquidus cluster
 * Sends SIGHUP to cluster master process to trigger graceful worker restart
 */

const { execSync } = require('child_process');

try {
  // Find the cluster master process (the one running bin/cluster directly)
  const output = execSync("ps aux | grep '[n]ode --stack-size.*bin/cluster' | awk '{print $2}'", { encoding: 'utf-8' });
  const pid = output.trim();
  
  if (!pid) {
    console.log('No cluster master process found. Is the explorer running?');
    process.exit(1);
  }
  
  console.log(`Reloading explorer cluster (PID: ${pid})...`);
  console.log('Sending SIGHUP to trigger graceful worker restart...');
  
  // Send SIGHUP to trigger graceful reload
  process.kill(parseInt(pid), 'SIGHUP');
  
  console.log('✓ Reload signal sent successfully.');
  console.log('Workers will restart gracefully without downtime.');
  
} catch (err) {
  console.error('Error reloading explorer:', err.message);
  process.exit(1);
}
