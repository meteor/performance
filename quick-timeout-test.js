#!/usr/bin/env node

/**
 * QUICK script to reproduce the timeout error
 * Specifically focuses on the line that causes the problem
 */

const { chromium } = require('playwright');

async function testSingleTimeout() {
  console.log('🧪 Quick test: Reproducing the specific TimeoutError...');
  
  const browser = await chromium.launch({ headless: false }); // headless: false to see what happens
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Intercept network requests to monitor backend data
  const networkLogs = [];
  page.on('response', response => {
    if (response.url().includes('sockjs') || response.url().includes('websocket') || response.url().includes('ddp')) {
      networkLogs.push({
        url: response.url(),
        status: response.status(),
        timestamp: new Date().toISOString()
      });
    }
  });
  
  // Intercept browser console messages
  page.on('console', msg => {
    if (msg.type() === 'log' || msg.type() === 'error') {
      console.log(`🌐 Browser Console [${msg.type()}]:`, msg.text());
    }
  });
  
  // Monitor DDP messages (if available)
  await page.addInitScript(() => {
    // Intercept Meteor.connection to see DDP data
    if (typeof Meteor !== 'undefined' && Meteor.connection) {
      const originalSend = Meteor.connection._send;
      Meteor.connection._send = function(msg) {
        console.log('📤 DDP Send:', JSON.stringify(msg));
        return originalSend.call(this, msg);
      };
      
      const originalOnMessage = Meteor.connection._onMessage;
      Meteor.connection._onMessage = function(raw_msg) {
        console.log('📥 DDP Receive:', raw_msg);
        return originalOnMessage.call(this, raw_msg);
      };
    }
  });
  
  try {
    page.setDefaultTimeout(120000); // 2 minutes as in the original test
    
    await page.goto('http://localhost:3000/');
    await page.getByLabel('Reactive', { exact: true }).check();
    await page.getByRole('button', { name: 'Remove all tasks' }).click();

    const sessionId = await page.textContent('span#sessionId');
    console.log(`Session ID: ${sessionId}`);

    // Make multiple clicks rapidly to overload
    console.log('Making multiple clicks rapidly...');
    
    for (let i = 1; i <= 10000; i++) {
      console.log(`Clicking Add task ${i}...`);
      
      // Check collection state before clicking
      const tasksCountBefore = await page.evaluate(() => {
        if (typeof Tasks !== 'undefined') {
          return Tasks.find().count();
        }
        return 'N/A - Tasks collection not available';
      });
      
      await page.getByRole('button', { name: 'Add task' }).click();
      
      // Wait a bit for DDP to process
      await page.waitForTimeout(100);
      
      // Check collection state after clicking
      const tasksCountAfter = await page.evaluate(() => {
        if (typeof Tasks !== 'undefined') {
          return Tasks.find().count();
        }
        return 'N/A - Tasks collection not available';
      });
      
      // Check if there's data in the collection corresponding to the expected task
      const hasTaskInCollection = await page.evaluate((sessionId, taskNumber) => {
        if (typeof Tasks !== 'undefined') {
          const task = Tasks.findOne({ text: `${sessionId} New Task ${taskNumber}` });
          return task ? { found: true, taskId: task._id, createdAt: task.createdAt } : { found: false };
        }
        return { found: false, reason: 'Tasks collection not available' };
      }, sessionId, i);
      
      console.log(`📊 Task ${i} - Antes: ${tasksCountBefore}, Depois: ${tasksCountAfter}, Na coleção: ${JSON.stringify(hasTaskInCollection)}`);
      
      // This is the EXACT line where the error occurs in test-helpers.js:17
      try {
        const startTime = Date.now();
        await page.waitForSelector(`text="${sessionId} New Task ${i}"`, { 
          state: 'visible',
          timeout: 9000 // Shorter timeout to reproduce faster
        });
        
        const endTime = Date.now();
        console.log(`✅ Task ${i} appeared in ${endTime - startTime}ms`);
        
      } catch (error) {
        console.error(`❌ TIMEOUT! Task ${i} did not appear - ${error.message}`);
        
        // Do detailed diagnosis when timeout occurs
        console.log('🔍 TIMEOUT DIAGNOSIS:');
        console.log(`   • Tasks before click: ${tasksCountBefore}`);
        console.log(`   • Tasks after click: ${tasksCountAfter}`);
        console.log(`   • Task found in collection: ${JSON.stringify(hasTaskInCollection)}`);
        
        // Check if similar elements exist in the DOM
        const similarElements = await page.evaluate((sessionId, taskNumber) => {
          const elements = Array.from(document.querySelectorAll('*')).filter(el => 
            el.textContent && el.textContent.includes(sessionId) && el.textContent.includes('New Task')
          );
          return elements.map(el => ({ 
            tagName: el.tagName, 
            text: el.textContent.trim(),
            visible: el.offsetParent !== null 
          }));
        }, sessionId, i);
        
        console.log(`   • Similar elements in DOM: ${JSON.stringify(similarElements, null, 2)}`);
        
        // Check recent network logs
        const recentNetworkLogs = networkLogs.slice(-5);
        console.log(`   • Recent network logs: ${JSON.stringify(recentNetworkLogs, null, 2)}`);
        
        console.error('🎯 ERROR REPRODUCED! This is exactly the Artillery failure.');
        break;
      }
    }
    
  } catch (error) {
    console.error('General error:', error.message);
  } finally {
    await browser.close();
  }
}

testSingleTimeout().catch(console.error);
