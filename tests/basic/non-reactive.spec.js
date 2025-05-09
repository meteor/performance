import { test, expect } from '@playwright/test';
import { nonReactiveAddAndRemoveTasks } from '../test-helpers';

test('non-reactive', async ({ page }) => {
  await nonReactiveAddAndRemoveTasks(page);
});
