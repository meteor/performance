import { test } from '@playwright/test';
import { complexReactiveScenario } from './helpers';

test('complex reactive scenario', async ({ page }) => {
  await complexReactiveScenario(page);
});
