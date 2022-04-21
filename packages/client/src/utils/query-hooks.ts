import {
  useQuery, QueryFunction, UseQueryResult, UseQueryOptions, QueryKey,
} from 'react-query';
import { useNavigate } from 'react-router-dom';

import { apiRoutes, pageRoutes } from '../routes';
import {
  api, AuthTokensResponse, saveAuthTokens, deleteAuthTokens, isAuthError, noAuthTokenError,
} from './api';

const refreshTokenGraceMs = 360_000; // 6 minutes before expiration

export function wrapQueryFunction<
  TQueryFnData = unknown,
  TQueryKey extends QueryKey = QueryKey
>(
  queryFn: QueryFunction<TQueryFnData, TQueryKey>,
): QueryFunction<TQueryFnData, TQueryKey> {
  const navigate = useNavigate();
  const wrappedQueryFn: QueryFunction<TQueryFnData, TQueryKey> = async (context) => {
    const authToken = window.sessionStorage.getItem('authToken');
    const authTokenExpiresAtString = window.sessionStorage.getItem('authTokenExpiresAt');
    let authTokenExpiresAt: Date | undefined;
    let result: TQueryFnData;
    try {
      if (!authToken || !authTokenExpiresAtString) {
        throw noAuthTokenError;
      }
      authTokenExpiresAt = new Date(authTokenExpiresAtString);
      if (authTokenExpiresAt.getTime() < Date.now()) {
        throw noAuthTokenError;
      }
      result = await queryFn(context);
    } catch (error) {
      if (isAuthError(error)) {
        deleteAuthTokens();
        navigate(pageRoutes.login, { replace: true });
      }
      throw error;
    }
    // query did not have any auth errors, let's check the refresh token
    if (authTokenExpiresAt.getTime() - Date.now() < refreshTokenGraceMs) {
      (async () => {
        const refreshToken = window.sessionStorage.getItem('refreshToken');
        if (!refreshToken) {
          return;
        }
        // prevent parallel attempts
        window.sessionStorage.removeItem('refreshToken');
        const newTokens = await api.post<AuthTokensResponse>(apiRoutes.authRefreshToken, {
          refreshToken,
        });
        saveAuthTokens(newTokens);
      })().catch((error) => {
        // eslint-disable-next-line no-console
        console.error('Failed to refresh auth token', error);
      });
    }
    return result;
  };
  return wrappedQueryFn;
}

export function useAuthQuery<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey
>(
  queryKey: TQueryKey,
  queryFn: QueryFunction<TQueryFnData, TQueryKey>,
  options?: Omit<UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>, 'queryKey' | 'queryFn'>,
): UseQueryResult<TData, TError> {
  const wrappedQueryFn = wrapQueryFunction(queryFn);
  const context = useQuery(
    queryKey,
    wrappedQueryFn,
    options,
  );
  return context;
}
