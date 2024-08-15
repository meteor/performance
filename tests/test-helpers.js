const timeout = 120000;

const addAndRemoveTasks = async ({ page, reactive, taskCount }) => {
  page.setDefaultTimeout(timeout);

  await page.goto(process.env.REMOTE_URL || 'http://localhost:3000/');
  await page.getByLabel(reactive ? 'Reactive' : 'No Reactive', { exact: true }).check();

  await page.getByRole('button', { name: 'Remove all tasks' }).click();

  const sessionId = await page.textContent('span#sessionId');

  const tasks = Array.from({ length: taskCount });
  let addedNum = 1;
  for await (const _addTask of tasks) {
    await page.getByRole('button', { name: 'Add task' }).click();
    await page.waitForSelector(`text="${sessionId} New Task ${addedNum}"`, { state: 'visible' });
    addedNum += 1;
  }
  let removedNum = 1;
  for await (const _removeTask of tasks) {
    await page.getByRole('button', { name: 'Remove task' }).click();
    await page.waitForSelector(`text="${sessionId} New Task ${removedNum}"`, { state: 'detached' });
    removedNum += 1;
  }

  await page.getByRole('button', { name: 'Remove all tasks' }).click();
};

async function reactiveAddAndRemoveTasks(page) {
  const taskCount = parseFloat(process.env.TASK_COUNT || 20);
  await addAndRemoveTasks({ page, reactive: true, taskCount });
}

async function nonReactiveAddAndRemoveTasks(page) {
  const taskCount = parseFloat(process.env.TASK_COUNT || 20);
  await addAndRemoveTasks({ page, reactive: false, taskCount });
}

module.exports = {
  reactiveAddAndRemoveTasks,
  nonReactiveAddAndRemoveTasks,
  addAndRemoveTasks,
}
