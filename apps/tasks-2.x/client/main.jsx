import React from 'react';
import { createRoot } from 'react-dom/client';
import { Meteor } from 'meteor/meteor';
import { initializeTaskCollection, registerTaskApi, App } from 'meteor/tasks-common';

Meteor.startup(() => {
  initializeTaskCollection();
  registerTaskApi();

  const container = document.getElementById('react-target');
  const root = createRoot(container);
  root.render(<App />);
});
