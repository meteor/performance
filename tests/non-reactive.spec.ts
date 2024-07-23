import { test, expect } from '@playwright/test';
import { addAndRemoveTasks } from './test-helpers';

const taskCount = parseFloat(process.env.TASK_COUNT || 1000);

test('non-reactive', async ({ page }) => {
  await addAndRemoveTasks({ page, reactive: false, taskCount});
});
