import React, { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import CssBaseline from '@mui/material/CssBaseline';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Container from '@mui/material/Container';
import CircularProgressIcon from '@mui/material/CircularProgress';
import { useQueryClient } from 'react-query';
import { useNavigate } from 'react-router-dom';

import {
  api, AuthTokensResponse, HttpError, PasswordlessLoginResponse, saveAuthTokens,
} from '../../utils/api';
import { apiRoutes, pageRoutes } from '../../routes';
import { errorToast } from '../../utils/toast';
import Copyright from '../copyright/Copyright';
import { ReactComponent as Logo } from '../../assets/images/logo.svg';

export default function Login() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isFormDisabled, setIsFormDisabled] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [showBackendErrorMessage, setShowBackendErrorMessage] = useState(false);
  const tryPasswordlessLogin = async () => {
    try {
      const response = await api.post<PasswordlessLoginResponse>(
        apiRoutes.authTryPasswordlessLogin, {},
      );
      setShowBackendErrorMessage(false);
      if (!response.ok) {
        setShowPasswordForm(true);
        return;
      }
      setShowPasswordForm(false);
      saveAuthTokens(response);
      queryClient.invalidateQueries();
      navigate(pageRoutes.home, { replace: true });
    } catch (error) {
      setShowBackendErrorMessage(true);
      errorToast(
        ((error instanceof HttpError) && error.message) || 'Internal error',
      );
    }
  };
  useEffect(() => {
    tryPasswordlessLogin();
  }, [tryPasswordlessLogin]);
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      setIsFormDisabled(true);
      const response = await api.post<AuthTokensResponse>(apiRoutes.authLogin, {
        password: data.get('password'),
      });
      saveAuthTokens(response);
      queryClient.invalidateQueries();
      navigate(pageRoutes.home, { replace: true });
    } catch (error) {
      errorToast(
        ((error instanceof HttpError) && error.message) || 'Internal error',
        {
          onClose: () => setIsFormDisabled(false),
        },
      );
    }
  };

  return (
    <Container component="main" maxWidth="xs">
      <CssBaseline />
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Logo style={{ width: 60, margin: 8 }} />
        <Typography component="h1" variant="h5">
          Log In
        </Typography>
        {
          !showPasswordForm && !showBackendErrorMessage && (
            <CircularProgressIcon sx={{ margin: 'auto', mt: 3 }} />
          )
        }
        {
          showPasswordForm && (
            <Box component="form" onSubmit={handleSubmit} noValidate sx={{ mt: 1 }}>
              <TextField
                margin="normal"
                required
                fullWidth
                name="password"
                label="Password"
                type="password"
                id="password"
                autoComplete="current-password"
                disabled={isFormDisabled}
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                sx={{ mt: 3, mb: 2 }}
                disabled={isFormDisabled}
              >
                Log In
              </Button>
            </Box>
          )
        }
        {
          showBackendErrorMessage && (
            <Typography component="p" color="error" sx={{ mt: 1 }}>
              Bad response from backend.
              Please try reloading the page, and if the problem persists reboot the server.
            </Typography>
          )
        }
      </Box>
      <Copyright />
    </Container>
  );
}
