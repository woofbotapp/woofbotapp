import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ReactQueryDevtools } from 'react-query/devtools';
import { ToastContainer } from 'react-toastify';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import 'react-toastify/dist/ReactToastify.css';

import App from './components/app/App';
import reportWebVitals from './report-web-vitals';
import './index.css';

const queryClient = new QueryClient();

const theme = createTheme({
  palette: {
    primary: {
      main: '#f2a900', // Bitcoin is orange
    },
  },
});

ReactDOM.render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <App />
          <ToastContainer />
        </ThemeProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
  document.getElementById('root'),
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
document.getElementsByTagName('html')[0].setAttribute('dir', 'rtl');
// eslint-disable-next-line no-console
reportWebVitals(console.log);
