#!/usr/bin/env node

/**
 * Script to monitor MongoDB metrics in real time,
 * focusing on Change Streams vs Oplog.
 * 
 * Requirements:
 * - Node.js
 * - 'mongodb' package installed: npm install mongodb
 * 
 * Usage:
 *   node scripts/monitor-mongo-metrics.js
 *   (or make executable: chmod +x scripts/monitor-mongo-metrics.js)
 */

const { MongoClient } = require('mongodb');
const os = require('os');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017,localhost:27018,localhost:27019/?replicaSet=rs0';
const INTERVAL = parseInt(process.env.INTERVAL) || 2000; // ms

async function printMetrics(db) {
  const admin = db.admin();

  // Connections
  const serverStatus = await admin.serverStatus();
  const connections = serverStatus.connections;
  const mem = serverStatus.mem || {};
  const opcounters = serverStatus.opcounters;
  const wiredTiger = serverStatus.wiredTiger || {};
  const changeStreams = (serverStatus.metrics && serverStatus.metrics.changeStreams) || {};

  // Active operations
  const currentOps = await admin.command({ currentOp: 1, $all: true });
  const activeOps = currentOps.inprog.filter(op => op.active);

  // Oplog (if it exists)
  let oplogStats = null;
  try {
    oplogStats = await db.collection('oplog.rs').stats();
  } catch (e) {
    // Not a replica set or no oplog
  }

  // Formatted output
  console.clear();
  console.log('=== MongoDB Real-time Metrics ===');
  console.log(`Host: ${serverStatus.host} | PID: ${serverStatus.pid}`);
  console.log(`Version: ${serverStatus.version} | Uptime: ${Math.round(serverStatus.uptime/60)} min`);
  console.log('');
  console.log('Connections:');
  console.log(`  Active: ${connections.current} | Available: ${connections.available} | Total Created: ${connections.totalCreated}`);
  console.log('');
  console.log('Change Streams:');
  if (Object.keys(changeStreams).length > 0) {
    console.log(`  Opened: ${changeStreams.opened || 0} | Closed: ${changeStreams.closed || 0} | Errors: ${changeStreams.failed || 0}`);
  } else {
    console.log('  (Metric not available in this MongoDB version)');
  }
  console.log('');
  if (oplogStats) {
    console.log('Oplog:');
    console.log(`  Size: ${(oplogStats.size/1024/1024).toFixed(2)} MB | Docs: ${oplogStats.count}`);
  } else {
    console.log('Oplog: Not available (not a replica set?)');
  }
  console.log('');
  console.log('Active Operations:');
  console.log(`  Total: ${activeOps.length}`);
  activeOps.slice(0, 5).forEach((op, i) => {
    console.log(`    [${i+1}] ${op.op} ns: ${op.ns} | ${op.desc || ''}`);
  });
  if (activeOps.length > 5) console.log('    ...');
  console.log('');
  console.log('CPU/RAM Usage (MongoDB):');
  if (mem.virtual) {
    console.log(`  RAM: ${mem.resident}MB resident | ${mem.virtual}MB virtual`);
  } else {
    console.log('  RAM: Metric not available');
  }
  if (wiredTiger.cache) {
    console.log(`  WiredTiger Cache: ${(wiredTiger.cache['bytes currently in the cache']/1024/1024).toFixed(2)} MB`);
  }
  console.log('');
  console.log('Operations per second:');
  console.log(`  Insert: ${opcounters.insert} | Query: ${opcounters.query} | Update: ${opcounters.update} | Delete: ${opcounters.delete} | GetMore: ${opcounters.getmore}`);
  console.log('');
  console.log('Press Ctrl+C to exit.');
}

async function main() {
  const client = new MongoClient(MONGO_URL, { useUnifiedTopology: true });
  await client.connect();
  const db = client.db();

  setInterval(() => {
    printMetrics(db).catch(err => {
      console.error('Error collecting metrics:', err.message);
    });
  }, INTERVAL);
}

main().catch(err => {
  console.error('Error connecting to MongoDB:', err.message);
  process.exit(1);
});