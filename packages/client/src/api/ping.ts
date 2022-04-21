import { apiRoutes } from '../routes';
import { api } from '../utils/api';
import { useAuthQuery } from '../utils/query-hooks';

export interface PingInterface {
  appName: string;
}

export const useGetPing = () => useAuthQuery<PingInterface>(
  apiRoutes.ping,
  () => api.get(apiRoutes.ping),
  {
    retry: false,
    refetchInterval: 300_000,
  },
);
