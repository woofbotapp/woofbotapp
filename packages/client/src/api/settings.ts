import { TelegramStatus } from '@woofbot/common';
import { useMutation, useQueryClient } from 'react-query';

import { apiRoutes } from '../routes';
import { api, HttpError } from '../utils/api';
import { useAuthQuery } from '../utils/query-hooks';
import { errorToast, successToast } from '../utils/toast';

export interface TelegramSettingsInterface {
  status: TelegramStatus;
  numberOfUsers: number;
  botUsername?: string;
  botName?: string;
}

export const useGetSettingsTelegram = () => useAuthQuery<TelegramSettingsInterface>(
  apiRoutes.settingsTelegram,
  () => api.get(apiRoutes.settingsTelegram),
);

export interface TelegramSettingsMutation {
  token: string | undefined;
}

export const useMutationSettingsTelegram = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation(
    (options: TelegramSettingsMutation) => api.post(apiRoutes.settingsTelegram, options),
    {
      onSuccess: () => {
        successToast('Telegram settings were saved successfully');
      },
      onError: (error) => {
        errorToast(
          ((error instanceof HttpError) && error.message) || 'Internal error',
        );
      },
      onSettled: () => {
        queryClient.invalidateQueries(apiRoutes.settingsTelegram);
      },
    },
  );
  return mutation;
};

interface WithMaxUsers {
  maxUsers: number;
  usersWhitelist: undefined;
}

interface WithUsersWhitelist {
  maxUsers: undefined;
  usersWhitelist: string[];
}

interface GeneralSettingsRequiredFields {
  bestBlockHeight: number;
  bestBlockId: string;
  bitcoindWatcherTasks: number;
  mempoolWeight: number;
  mempoolUrlPrefix: string;
}

export type GeneralSettingsInterface = GeneralSettingsRequiredFields & (
  WithMaxUsers | WithUsersWhitelist
)

export const useGetSettingsGeneral = () => useAuthQuery<GeneralSettingsInterface>(
  apiRoutes.settingsGeneral,
  () => api.get(apiRoutes.settingsGeneral),
);

interface MaxUsersMutation {
  maxUsers: number;
}

interface UsersWhitelistMutation {
  usersWhitelist: string[];
}

interface GeneralSettingsMutationRequiredFields {
  mempoolUrlPrefix: string;
}

type GeneralSettingsMutation = GeneralSettingsMutationRequiredFields & (
  MaxUsersMutation | UsersWhitelistMutation
)

export const useMutationSettingsGeneral = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation(
    (options: GeneralSettingsMutation) => api.post(apiRoutes.settingsGeneral, options),
    {
      onSuccess: () => {
        successToast('Settings were saved successfully');
      },
      onError: (error) => {
        errorToast(
          ((error instanceof HttpError) && error.message) || 'Internal error',
        );
      },
      onSettled: () => {
        queryClient.invalidateQueries(apiRoutes.settingsGeneral);
      },
    },
  );
  return mutation;
};
