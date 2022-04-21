import React, { useState } from 'react';
import Button from '@mui/material/Button';
import CssBaseline from '@mui/material/CssBaseline';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Container from '@mui/material/Container';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from 'react-query';

import { api, deleteAuthTokens, HttpError } from '../../utils/api';
import { apiRoutes, pageRoutes } from '../../routes';
import { errorToast, successToast } from '../../utils/toast';
import Copyright from '../copyright/Copyright';
import { ReactComponent as Logo } from '../../assets/images/logo.svg';

export default function ChangePassword() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isFormDisabled, setIsFormDisabled] = useState(false);
  const [hadMistypedPassword, setHadMistypedPassword] = useState(false);
  const [newPasswordsMatch, setNewPasswordMatch] = useState(true);

  const handleChange = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const newPassword = data.get('newPassword');
    const newPasswordReentered = data.get('newPasswordReentered');
    setNewPasswordMatch(newPassword === newPasswordReentered);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const oldPassword = data.get('oldPassword');
    const newPassword = data.get('newPassword');
    const newPasswordReentered = data.get('newPasswordReentered');
    if (newPassword !== newPasswordReentered) {
      setHadMistypedPassword(true);
      return;
    }
    try {
      setIsFormDisabled(true);
      await api.post<unknown>(apiRoutes.authChangePassword, {
        oldPassword,
        newPassword,
      });
      // Changing the password revokes all tokens
      deleteAuthTokens();
      queryClient.invalidateQueries();
      successToast('Password changed successfully', {
        onClose: () => navigate(pageRoutes.login, { replace: true }),
      });
    } catch (error) {
      errorToast(
        ((error instanceof HttpError) && error.message) || 'Internal error',
        {
          onClose: () => setIsFormDisabled(false),
        },
      );
    }
  };

  const passwordsDifferentWarning = (hadMistypedPassword && !newPasswordsMatch) && 'Passwords are not the same';

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
          Change Password
        </Typography>
        <Box component="form" onSubmit={handleSubmit} onChange={handleChange} noValidate sx={{ mt: 1 }}>
          <TextField
            margin="normal"
            required
            fullWidth
            name="oldPassword"
            label="Old Password"
            type="password"
            id="oldPassword"
            autoComplete="current-password"
            disabled={isFormDisabled}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            name="newPassword"
            label="New Password"
            type="password"
            id="newPassword"
            autoComplete="current-password"
            disabled={isFormDisabled}
          />
          <TextField
            error={Boolean(passwordsDifferentWarning)}
            helperText={passwordsDifferentWarning}
            margin="normal"
            required
            fullWidth
            name="newPasswordReentered"
            label="Reenter New Password"
            type="password"
            id="newPasswordReentered"
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
            Change Password
          </Button>
        </Box>
      </Box>
      <Copyright />
    </Container>
  );
}
