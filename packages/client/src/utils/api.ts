interface AuthorizationHeaders {
  Authorization?: string;
}

export interface AuthTokensResponse {
  authToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function saveAuthTokens({
  authToken, refreshToken, expiresIn,
}: AuthTokensResponse) {
  window.sessionStorage.setItem('authToken', `${authToken || ''}`);
  window.sessionStorage.setItem('refreshToken', `${refreshToken || ''}`);
  const authTokenExpiresAt = new Date(Date.now() + (Number(expiresIn) || 0));
  window.sessionStorage.setItem('authTokenExpiresAt', authTokenExpiresAt.toJSON());
}

export function deleteAuthTokens() {
  for (const item of ['authToken', 'authTokenExpiresAt', 'refreshToken']) {
    window.sessionStorage.removeItem(item);
  }
}

const sessionStorageToken = (): AuthorizationHeaders => {
  const authToken = window.sessionStorage.getItem('authToken');
  if (!authToken) {
    return {};
  }
  return {
    Authorization: `Bearer ${authToken}`,
  };
};

export const noAuthTokenError = new Error('No auth token');

export class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const isAuthError = (error: unknown) => (
  (error === noAuthTokenError)
  || ((error instanceof HttpError) && (error.status === 401))
);

async function handleJsonResponse<T>(response: Response): Promise<T> {
  const responseJson = await response.json().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Failed to parse response json', error);
    return undefined;
  });
  if (!responseJson) {
    throw new Error(`Unprasable response json, status code ${response.status}`);
  }
  if ((response.status < 200) || (response.status >= 300)) {
    throw new HttpError(
      (typeof responseJson.error === 'string') ? responseJson.error : 'Unexpected error',
      response.status,
    );
  }
  return responseJson;
}

export const api = {
  get: <T>(url: string, params?: object) => window.fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...sessionStorageToken(),
    },
    ...params,
  }).then(handleJsonResponse) as Promise<T>,
  post: <T>(url: string, data: any, params?: object) => window.fetch(url, {
    method: 'POST',
    cache: 'no-cache',
    headers: {
      'Content-Type': 'application/json',
      ...sessionStorageToken(),
    },
    body: JSON.stringify(data),
    ...params,
  }).then(handleJsonResponse) as Promise<T>,
  delete: <T>(url: string, params?: object) => window.fetch(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...sessionStorageToken(),
    },
    ...params,
  }).then(handleJsonResponse) as Promise<T>,
};
