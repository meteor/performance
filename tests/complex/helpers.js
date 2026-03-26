const timeout = 120000;

const TASK_COUNT = parseFloat(process.env.TASK_COUNT || 5);
const CHECKLIST_ITEMS_PER_TASK = parseFloat(process.env.CHECKLIST_ITEMS || 3);
const COMMENTS_PER_TASK = parseFloat(process.env.COMMENTS_PER_TASK || 2);
const REPLIES_PER_COMMENT = parseFloat(process.env.REPLIES_PER_COMMENT || 2);

const complexReactiveScenario = async (page) => {
  page.setDefaultTimeout(timeout);

  // Navigate to /complex
  await page.goto(process.env.REMOTE_URL
    ? `${process.env.REMOTE_URL}/complex`
    : 'http://localhost:3000/complex');

  // Step 1: Register
  await page.waitForSelector('#register-btn', { state: 'visible' });
  await page.click('#register-btn');
  await page.waitForSelector('#username', { state: 'visible' });

  // Step 2: Add tasks
  for (let t = 1; t <= TASK_COUNT; t++) {
    await page.click('.add-task');
    await page.waitForSelector(`text="Task ${t}"`, { state: 'visible' });
  }

  // Step 3: For each task, expand and add checklists + comments
  const expandButtons = await page.$$('.toggle-details');
  for (let t = 0; t < expandButtons.length; t++) {
    // Expand task
    await expandButtons[t].click();

    // Wait for checklist section to appear
    await page.waitForSelector('.checklist-section', { state: 'visible' });

    // Add checklist items
    const addChecklistBtns = await page.$$('.add-checklist-item');
    const checklistBtn = addChecklistBtns[addChecklistBtns.length - 1];
    for (let c = 1; c <= CHECKLIST_ITEMS_PER_TASK; c++) {
      await checklistBtn.click();
      await page.waitForSelector(`text="Item ${c}"`, { state: 'visible' });
    }

    // Toggle first checklist item
    const checkboxes = await page.$$('.checklist-item input[type="checkbox"]');
    if (checkboxes.length > 0) {
      await checkboxes[checkboxes.length - CHECKLIST_ITEMS_PER_TASK].click();
    }

    // Add comments
    const addCommentBtns = await page.$$('.add-comment');
    const commentBtn = addCommentBtns[addCommentBtns.length - 1];
    for (let c = 1; c <= COMMENTS_PER_TASK; c++) {
      await commentBtn.click();
      await page.waitForSelector(`text="Comment ${c}"`, { state: 'visible' });
    }

    // Add replies to the first comment
    const replyBtns = await page.$$('.add-subcomment');
    if (replyBtns.length > 0) {
      const lastReplyBtn = replyBtns[replyBtns.length - COMMENTS_PER_TASK];
      for (let r = 1; r <= REPLIES_PER_COMMENT; r++) {
        await lastReplyBtn.click();
        await page.waitForSelector(`text="Reply ${r}"`, { state: 'visible' });
      }
    }
  }

  // Step 4: Cycle task statuses (pending -> in-progress)
  const cycleButtons = await page.$$('.cycle-status');
  for (const btn of cycleButtons) {
    await btn.click();
  }

  // Wait for summary to reflect status changes
  await page.waitForSelector('.summary-in-progress', { state: 'visible' });

  // Step 5: Remove all tasks
  await page.click('.remove-all-tasks');
  await page.waitForSelector('.complex-task', { state: 'detached', timeout: 30000 });

  // Step 6: Logout
  await page.click('#logout-btn');
  await page.waitForSelector('#register-btn', { state: 'visible' });
};

module.exports = {
  complexReactiveScenario,
};
