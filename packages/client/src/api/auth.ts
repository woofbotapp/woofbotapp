import { apiRoutes } from '../routes';
import { api } from '../utils/api';
import { useAuthQuery } from '../utils/query-hooks';

export const usePostLogout = () => useAuthQuery<unknown>(
  apiRoutes.authLogout,
  () => api.post(apiRoutes.authLogout, {}),
  {
    retry: false,
  },
);
