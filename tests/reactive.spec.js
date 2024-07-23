import { test, expect } from '@playwright/test';
import { reactiveAddAndRemoveTasks } from './test-helpers';

test('reactive', async ({ page }) => {
  await reactiveAddAndRemoveTasks(page);
});
