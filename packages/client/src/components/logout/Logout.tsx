import React, { useEffect } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from 'react-query';

import { usePostLogout } from '../../api/auth';
import { deleteAuthTokens, isAuthError } from '../../utils/api';
import { pageRoutes } from '../../routes';
import { errorToast } from '../../utils/toast';

export default function Logout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = usePostLogout();
  useEffect(() => {
    if (logout.isSuccess || isAuthError(logout.error)) {
      deleteAuthTokens();
      queryClient.invalidateQueries();
      navigate(pageRoutes.login, { replace: true });
    }
  }, [logout.isSuccess, logout.error, navigate]);
  useEffect(() => {
    if (logout.error && !isAuthError(logout.error)) {
      errorToast(
        'Logout failed',
        {
          onClose: () => {
            window.location.reload();
          },
        },
      );
    }
  }, [logout.error]);

  return (
    <Box
      sx={{
        marginTop: 4,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {
        (logout.isLoading || isAuthError(logout.error)) && (
          <CircularProgress color="inherit" size={24} />
        )
      }
    </Box>
  );
}
