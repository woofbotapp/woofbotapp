import { ReactText } from 'react';
import { toast, ToastContent, ToastOptions } from 'react-toastify';

const defaultToastOptions = {
  position: toast.POSITION.TOP_CENTER,
  rtl: false,
};

export const errorToast = (
  content: ToastContent, options?: ToastOptions<{}>,
): ReactText => toast.error(content, {
  ...defaultToastOptions,
  autoClose: 4000,
  ...options,
});

export const successToast = (
  content: ToastContent, options?: ToastOptions<{}>,
): ReactText => toast.success(content, {
  ...defaultToastOptions,
  autoClose: 2000,
  ...options,
});
