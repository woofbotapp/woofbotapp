import React, { useState } from 'react';
import Typography from '@mui/material/Typography';
import CircularProgressIcon from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';

import { useGetSettingsGeneral, useMutationSettingsGeneral } from '../../api/settings';
import ExternalLink from '../external-link/ExternalLink';
import { errorToast } from '../../utils/toast';

const maxUsersTextFieldHelper = `\
Setting this value below the current number of users will not kick users out, \
but will prevent new users from registering.\
`;

export default function GeneralSettings() {
  const { data, isLoading: isGetSettingsLoading } = useGetSettingsGeneral();
  const { mutate, isLoading: isMutationLoading } = useMutationSettingsGeneral();
  const [isEditing, setIsEditing] = useState(false);
  const openEditing = () => {
    setIsEditing(true);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const maxUsers = Number(formData.get('maxUsers'));
    if (!Number.isSafeInteger(maxUsers) || (maxUsers < 0)) {
      errorToast('Max-Users must be a safe non-negative integer');
      return;
    }
    mutate({ maxUsers });
    setIsEditing(false);
  };

  const handleReset = async () => {
    setIsEditing(false);
  };

  if (isGetSettingsLoading || !data) {
    return (
      <CircularProgressIcon sx={{ margin: 'auto' }} />
    );
  }

  if (!isEditing) {
    return (
      <>
        <Typography component="p">
          Max number of users:
          {' '}
          {data.maxUsers}
        </Typography>
        <Typography component="p">
          Best block height:
          {' '}
          <ExternalLink
            href={`https://mempool.space/block/${encodeURIComponent(data.bestBlockId)}`}
          >
            {data.bestBlockHeight}
          </ExternalLink>
        </Typography>
        <Typography component="p">
          Mempool weight:
          {' '}
          {data.mempoolWeight}
        </Typography>
        <Typography component="p" sx={{ flex: 1 }}>
          Bitcoind-Watcher Queued Tasks:
          {' '}
          {data.bitcoindWatcherTasks}
        </Typography>
        <Box>
          <Button
            variant="outlined"
            onClick={openEditing}
          >
            Edit
          </Button>
        </Box>
      </>
    );
  }

  return (
    <Box
      component="form"
      noValidate
      onSubmit={handleSubmit}
      onReset={handleReset}
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ flex: 1 }}>
        <TextField
          defaultValue={data.maxUsers}
          required
          margin="dense"
          name="maxUsers"
          label="Max users"
          type="number"
          id="maxUsers"
          disabled={isMutationLoading}
          fullWidth
          helperText={maxUsersTextFieldHelper}
        />
      </Box>
      <Box>
        <Button
          type="submit"
          variant="contained"
          disabled={isMutationLoading}
        >
          Save
        </Button>
        <Button
          type="reset"
          variant="outlined"
          disabled={isMutationLoading}
          sx={{ ml: 1 }}
        >
          Cancel
        </Button>
      </Box>
    </Box>
  );
}
