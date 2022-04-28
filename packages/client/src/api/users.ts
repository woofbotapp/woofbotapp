import { useMutation, useQueryClient } from 'react-query';

import { errorToast, successToast } from '../utils/toast';
import { apiRoutes } from '../routes';
import { api, HttpError } from '../utils/api';
import { CursorPaginationBody } from '../utils/jsonapi';
import { useInfiniteAuthQuery } from '../utils/query-hooks';

interface UserAttributes {
  telegramChatId: string;
  telegramFromId: string;
  telegramUsername: string;
  watchReboot: boolean;
  createdAt: string;
  updatedAt: string;
}

export const useUsers = () => useInfiniteAuthQuery<CursorPaginationBody<UserAttributes, 'users'>>(
  apiRoutes.users,
  ({ pageParam }) => {
    if (!pageParam) {
      return api.get(`${apiRoutes.users}?page[size]=10`);
    }
    return api.get(pageParam);
  },
);

interface UserDelete {
  id: string;
}

export const useMutationDeleteUser = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation(
    ({ id }: UserDelete) => api.delete(`${apiRoutes.users}/${encodeURIComponent(id)}`),
    {
      onSuccess: () => {
        successToast('User was deleted successfully');
      },
      onError: (error) => {
        errorToast(
          ((error instanceof HttpError) && error.message) || 'Internal error',
        );
      },
      onSettled: () => {
        queryClient.invalidateQueries(apiRoutes.settingsTelegram);
        queryClient.invalidateQueries(apiRoutes.users);
      },
    },
  );
  return mutation;
};
