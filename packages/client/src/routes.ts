export const apiRoutes = {
  authLogin: '/api/auth/login',
  authTryPasswordlessLogin: '/api/auth/try-passwordless-login',
  authLogout: '/api/auth/logout',
  authChangePassword: '/api/auth/change-password',
  authRefreshToken: '/api/auth/refresh-token',
  ping: '/api/ping',
  settingsGeneral: '/api/settings/general',
  settingsTelegram: '/api/settings/telegram',
  settingsCommandsPermissionGroups: '/api/settings/commands-permission-groups',
  stats: '/api/stats',
  users: '/api/users',
};

export const pageRoutes = {
  home: '/',
  login: '/login',
  logout: '/logout',
  changePassword: '/change-password',
  users: '/users',
};
