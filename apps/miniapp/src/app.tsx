import { PropsWithChildren } from 'react';

import { installErrorReporting } from './api/report';
import './app.css';

installErrorReporting();

function App({ children }: PropsWithChildren) {
  return children;
}

export default App;
