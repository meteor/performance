#!/usr/bin/env node

const { chromium } = require('playwright');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const CONCURRENT_USERS = parseInt(process.env.CONCURRENT_USERS) || 30; // Number that causes error based on analysis
const PARALLEL_PROCESSES = parseInt(process.env.PARALLEL_PROCESSES) || os.cpus().length; // Number of parallel processes
const TIMEOUT = parseInt(process.env.TIMEOUT) || 60000; // 1 minute
const TASK_COUNT = parseInt(process.env.TASK_COUNT) || 20; // Default number of tasks
const BASE_URL = process.env.REMOTE_URL || 'http://localhost:3000/';
const CLEAR_COLLECTION = process.env.CLEAR_COLLECTION === 'true'; // New variable to clear collection

// Function that exactly replicates test-helpers.js
async function addAndRemoveTasks(page, sessionPrefix) {
  page.setDefaultTimeout(TIMEOUT);
  // Logs suppressed for concise execution
  
  try {
    await page.goto(BASE_URL);
    await page.getByLabel('Reactive', { exact: true }).check();
    await page.getByRole('button', { name: 'Remove all tasks' }).click();

    const sessionId = await page.textContent('span#sessionId');
    const tasks = Array.from({ length: TASK_COUNT });
    let addedNum = 1;
    for await (const _addTask of tasks) {
      try {
        await page.getByRole('button', { name: 'Add task' }).click();
        await page.waitForTimeout(100);
        await page.waitForSelector(`text="${sessionId} New Task ${addedNum}"`, { 
          state: 'visible',
          timeout: TIMEOUT 
        });
      } catch (error) {
        console.error(`[${sessionPrefix}] ❌ TIMEOUT on task ${addedNum}`);
        console.error(`[${sessionPrefix}] Error: ${error.message}`);
        throw error;
      }
      addedNum += 1;
    }
  } catch (error) {
    console.error(`[${sessionPrefix}] ❌ FAILURE: ${error.message}`);
    throw error;
  }
}

// Function to create a virtual user
async function createVirtualUser(userIndex) {
  const browser = await chromium.launch({ 
    headless: true,
    // Simulate resource overload
    args: ['--no-sandbox', '--disable-dev-shm-usage'] 
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    await addAndRemoveTasks(page, `USER-${userIndex.toString().padStart(2, '0')}`);
    return { success: true, userIndex };
  } catch (error) {
    // Just error
    return { success: false, userIndex, error: error.message };
  } finally {
    await browser.close();
  }
}

// Main function that simulates Artillery with arrivalRate: 4
async function simulateArtilleryLoad() {
  // Logs suppressed
  
  if (CLEAR_COLLECTION) {
    await clearTaskCollection();
  }
  
  const promises = [];
  for (let i = 1; i <= CONCURRENT_USERS; i++) {
    promises.push(createVirtualUser(i));
    if (i % 4 === 0) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  await Promise.allSettled(promises);
}

// Check if server is running
async function checkServer() {
  // Logs suppressed
  
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(BASE_URL, { timeout: 10000 });
    await browser.close();
    return true;
  } catch (error) {
    console.error('❌ Server is not running!');
    console.error(`   Error: ${error.message}`);
    return false;
  }
}

// Function to clear taskCollection via MongoDB
async function clearTaskCollection() {
  if (!CLEAR_COLLECTION) {
    return;
  }
  
  // Logs suppressed
  
  try {
    const { MongoClient } = require('mongodb');
    const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017,localhost:27018,localhost:27019/?replicaSet=rs0';
    
    const client = new MongoClient(mongoUrl);
    await client.connect();
    
    const db = client.db();
    const result = await db.collection('taskCollection').deleteMany({});
    
    // Logs suppressed
    await client.close();
    
  } catch (error) {
    console.warn(`⚠️  Could not clear via MongoDB: ${error.message}`);
    console.log('🔄 Trying to clear via web interface...');
    await clearTaskCollectionViaWeb();
  }
}

// Alternative function to clear via web interface
async function clearTaskCollectionViaWeb() {
  if (!CLEAR_COLLECTION) {
    return;
  }
  
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    await page.goto(BASE_URL);
    await page.getByRole('button', { name: 'Remove all tasks' }).click();
    
    // Wait a bit to ensure it cleared
    await page.waitForTimeout(2000);
    
    await browser.close();
    // Logs suppressed
    
  } catch (error) {
    console.error(`❌ Error clearing via web: ${error.message}`);
  }
}

// Run simulation
async function main() {
  // Logs suppressed
  
  if (await checkServer()) {
    await clearTaskCollection();
    await simulateArtilleryLoad();
  }
}


if (require.main === module) {
  if (isMainThread) {
    main().then(() => {
      const usersPerWorker = Math.ceil(CONCURRENT_USERS / PARALLEL_PROCESSES);
      const workers = [];
      let finished = 0;
      let results = [];

      for (let i = 0; i < PARALLEL_PROCESSES; i++) {
        const startUser = i * usersPerWorker + 1;
        const endUser = Math.min((i + 1) * usersPerWorker, CONCURRENT_USERS);
        if (startUser > endUser) continue;
        workers.push(new Promise((resolve, reject) => {
          const worker = new Worker(__filename, {
            workerData: {
              startUser,
              endUser,
              workerIndex: i + 1,
              totalWorkers: PARALLEL_PROCESSES,
              env: process.env
            }
          });
          worker.on('message', (msg) => {
            if (msg && msg.type === 'result') {
              results.push(msg.data);
            }
          });
          worker.on('error', reject);
          worker.on('exit', (code) => {
            finished++;
            if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
            else resolve();
          });
        }));
      }
      Promise.all(workers).then(() => {
        console.log('All workers finished.');
      }).catch(console.error);
    }).catch(console.error);
  } else {
    const { startUser, endUser, workerIndex, totalWorkers, env } = workerData;
    process.env = { ...env };
    async function workerMain() {
      console.log(`[Worker ${workerIndex}/${totalWorkers}] Simulating users from ${startUser} to ${endUser}`);
      global.CONCURRENT_USERS = endUser - startUser + 1;
      const startTime = Date.now();
      const promises = [];
      for (let i = startUser; i <= endUser; i++) {
        promises.push(createVirtualUser(i));
      }
      const results = await Promise.allSettled(promises);
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;
      console.log(`[Worker ${workerIndex}] RESULT: ${successful} success, ${failed} failure, duration: ${duration.toFixed(2)}s`);
      if (parentPort) parentPort.postMessage({ type: 'result', data: { workerIndex, successful, failed, duration } });
    }
    workerMain().catch((err) => {
      console.error(`[Worker ${workerIndex}] Error:`, err);
      process.exit(1);
    });
  }
}

module.exports = { simulateArtilleryLoad, createVirtualUser, addAndRemoveTasks };
