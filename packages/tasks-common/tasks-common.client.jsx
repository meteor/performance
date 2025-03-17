import React, { Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { App as AppBasic } from './basic/client';
import { App as AppComplex } from './complex/client';
import { TasksCollection, initializeTaskCollection, registerTaskApi  } from './tasks-common';

const AppBasicWrapper = (props) => (
  <Suspense fallback={<div>Loading...</div>}>
    <AppBasic {...props} />
  </Suspense>
);

const AppComplexWrapper = (props) => (
    <Suspense fallback={<div>Loading...</div>}>
        <AppComplex {...props} />
    </Suspense>
);

const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path={'/'} element={<AppBasicWrapper />} />
      <Route path="/complex" element={<AppComplexWrapper />} />
    </Routes>
  </BrowserRouter>
);

export { TasksCollection, initializeTaskCollection, registerTaskApi, App };
