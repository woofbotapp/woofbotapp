import { useMutation, useQueryClient } from 'react-query';

import { errorToast, successToast } from '../utils/toast';
import { apiRoutes } from '../routes';
import { api, HttpError } from '../utils/api';
import { CursorPaginationBody, BodyWithRelationships } from '../utils/jsonapi';
import { useInfiniteAuthQuery, useAuthQuery } from '../utils/query-hooks';

interface UserAttributes {
  telegramChatId: string;
  telegramFromId: string;
  telegramUsername: string;
  watchReboot: boolean;
  watchNewBlocks: boolean;
  watchPriceChange?: number;
  watchMempoolClear: boolean;
  permissionGroups: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WatchedAddressAttributes {
  address: string;
  nickname?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WatchedTransactionAttributes {
  txid: string;
  nickname?: string;
  status: string;
  blockHashes?: string[];
  confirmations: number;
  conflictingTransactions?: string[];
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

export const useUser = (userId: string) => useAuthQuery<BodyWithRelationships<
  UserAttributes, 'users',
  'watchedTransactions' | 'watchedAddresses',
  WatchedAddressAttributes, 'watched-addresses',
  WatchedTransactionAttributes, 'watched-transactions'
>>(
  [apiRoutes.users, userId],
  () => api.get(`${apiRoutes.users}/${userId}`),
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

export interface UserPatch {
  id: string;
  permissionGroups?: string[];
}

export const useMutationPatchUser = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation(
    ({ id, ...attributes }: UserPatch) => api.patch(
      `${apiRoutes.users}/${encodeURIComponent(id)}`,
      {
        data: {
          id,
          type: 'users',
          attributes,
        },
      },
    ),
    {
      onSuccess: () => {
        successToast('User changes were saved successfully');
      },
      onError: (error) => {
        errorToast(
          ((error instanceof HttpError) && error.message) || 'Internal error',
        );
      },
      onSettled: () => {
        queryClient.invalidateQueries(apiRoutes.users);
      },
    },
  );
  return mutation;
};
