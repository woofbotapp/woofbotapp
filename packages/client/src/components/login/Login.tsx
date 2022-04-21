import React, { useState } from 'react';
import Button from '@mui/material/Button';
import CssBaseline from '@mui/material/CssBaseline';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Container from '@mui/material/Container';
import { useQueryClient } from 'react-query';
import { useNavigate } from 'react-router-dom';

import {
  api, AuthTokensResponse, HttpError, saveAuthTokens,
} from '../../utils/api';
import { apiRoutes, pageRoutes } from '../../routes';
import { errorToast } from '../../utils/toast';
import Copyright from '../copyright/Copyright';
import { ReactComponent as Logo } from '../../assets/images/logo.svg';

export default function Login() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isFormDisabled, setIsFormDisabled] = useState(false);
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
      </Box>
      <Copyright />
    </Container>
  );
}
