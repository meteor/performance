import * as async_hooks from 'node:async_hooks';
import * as fs from 'node:fs';

export const AHCapture = {
  active: false,
}

const asyncResources = new Map();

function logResourceCreation(asyncId, type, triggerAsyncId, resource) {
  const stack = (new Error()).stack.split('\n').slice(2).filter(line => {
    return !['AsyncHook.init', 'node:internal/async_hooks'].some(fn => line.includes(fn));
  }).join('\n');

  if (!asyncResources.has(stack)) {
    asyncResources.set(stack, { count: 0, types: new Set() });
  }

  const resourceInfo = asyncResources.get(stack);
  resourceInfo.count++;
  resourceInfo.types.add(type);
}

const hooks = async_hooks.createHook({
  init(asyncId, type, triggerAsyncId, resource) {
    if (!AHCapture.active) {
      return;
    }

    logResourceCreation(asyncId, type, triggerAsyncId, resource);
  },
});

hooks.enable();

function printResults() {
  let logs = []

  asyncResources.forEach((info, stack) => {
    if (info.count <= 1) {
      return;
    }

    logs.push({
      count: info.count,
      types: [...info.types],
      stack,
    });
  });

  logs = logs.sort((a, b) => b.count - a.count);

  console.log(process.cwd())

  fs.writeFileSync('async-resources.json', JSON.stringify(logs, null, 2));
}

// Set up an interval to print results periodically
setInterval(printResults, 5000);

