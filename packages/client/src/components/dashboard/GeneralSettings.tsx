import React, { useState, useRef, useEffect } from 'react';
import Typography from '@mui/material/Typography';
import CircularProgressIcon from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import FormLabel from '@mui/material/FormLabel';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import { BotCommandName } from '@woofbot/common';
import { MuiChipsInput } from 'mui-chips-input';

import { useGetSettingsGeneral, useMutationSettingsGeneral } from '../../api/settings';
import ExternalLink from '../external-link/ExternalLink';
import { errorToast } from '../../utils/toast';

enum EntryRestriction {
  MaxUsers = 'maxUsers',
  UsersWhitelist = 'usersWhitelist',
}

const maxUsersTextFieldHelper = `\
Setting this value below the current number of users will not kick users out, \
but will prevent new users from registering.\
`;

function preventEnter(event: React.KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault();
  }
}

export default function GeneralSettings() {
  const { data, isLoading: isGetSettingsLoading } = useGetSettingsGeneral();
  const { mutate, isLoading: isMutationLoading } = useMutationSettingsGeneral();
  const [isEditing, setIsEditing] = useState(false);
  const [entryRestriction, setEntryRestriction] = useState<EntryRestriction>(
    EntryRestriction.UsersWhitelist,
  );
  const [usersWhitelist, setUsersWhitelist] = useState<string[]>([]);
  const [maxUsers, setMaxUsers] = useState<string>('');
  const usersWhitelistRef = useRef<HTMLInputElement>(null);
  const maxUsersRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (entryRestriction === EntryRestriction.UsersWhitelist) {
      usersWhitelistRef.current?.focus();
    }
  }, [usersWhitelistRef, entryRestriction]);

  useEffect(() => {
    if (entryRestriction === EntryRestriction.MaxUsers) {
      maxUsersRef.current?.focus();
    }
  }, [maxUsersRef, entryRestriction]);

  const openEditing = () => {
    if (data?.usersWhitelist !== undefined) {
      setEntryRestriction(EntryRestriction.UsersWhitelist);
      setUsersWhitelist(data.usersWhitelist.map((user) => `@${user}`));
      setMaxUsers('');
    } else if (data?.maxUsers !== undefined) {
      setEntryRestriction(EntryRestriction.MaxUsers);
      setUsersWhitelist([]);
      setMaxUsers(`${data.maxUsers}`);
    }
    setIsEditing(true);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const mutation = (() => {
      if (entryRestriction === EntryRestriction.UsersWhitelist) {
        return {
          usersWhitelist: usersWhitelist.map((user) => user.replace(/^@/, '')),
        };
      }
      // entryRestriction === EntryRestriction.MaxUsers
      const maxUsersNumber = maxUsers ? Number(maxUsers) : undefined;
      if (
        (maxUsersNumber === undefined)
        || !Number.isSafeInteger(maxUsersNumber)
        || (maxUsersNumber < 0)
      ) {
        errorToast('Max-Users must be a safe non-negative integer');
        return undefined;
      }
      return { maxUsers: maxUsersNumber };
    })();
    if (mutation) {
      mutate({
        ...mutation,
        mempoolUrlPrefix: `${formData.get('mempoolUrlPrefix')}`,
      });
      setIsEditing(false);
    }
  };

  const handleReset = async () => {
    setIsEditing(false);
  };

  const updateUsersWhitelist = (newUsers: string[]) => {
    const fixedUsers = newUsers.map(
      (user) => (user[0] === '@' ? user : `@${user}`).slice(0, 100),
    );
    const fixedUsersSet = new Set();
    setUsersWhitelist(fixedUsers.filter((user) => {
      if (fixedUsersSet.has(user)) {
        return false;
      }
      fixedUsersSet.add(user);
      return true;
    }));
  };

  const updateMaxUsers = (event: React.ChangeEvent<HTMLInputElement>) => {
    setMaxUsers(event.target.value.replace(/\D/g, ''));
  };

  if (isGetSettingsLoading || !data) {
    return (
      <CircularProgressIcon sx={{ margin: 'auto' }} />
    );
  }

  if (!isEditing) {
    return (
      <>
        {
          (data.maxUsers !== undefined) && (
            <Typography component="p">
              Max number of users:
              {' '}
              {data.maxUsers ?? 'unlimited'}
            </Typography>
          )
        }
        {
          (data.usersWhitelist !== undefined) && (
            <Typography component="p">
              Users whitelist:
              {' '}
              {
                data.usersWhitelist.length === 0
                  ? (<Typography component="span">empty</Typography>)
                  : (
                    data.usersWhitelist.map((user, userIndex) => (
                      <Typography component="span" key={user}>
                        {userIndex > 0 && ', '}
                        <ExternalLink
                          href={`https://t.me/${encodeURIComponent(user)}`}
                        >
                          @
                          {user}
                        </ExternalLink>
                      </Typography>
                    ))
                  )
              }
            </Typography>
          )
        }
        <Typography component="p">
          Best block height:
          {' '}
          <ExternalLink
            href={`${data.mempoolUrlPrefix}/block/${encodeURIComponent(data.bestBlockId)}`}
          >
            {data.bestBlockHeight}
          </ExternalLink>
        </Typography>
        <Typography component="p">
          Mempool weight:
          {' '}
          {data.mempoolWeight}
        </Typography>
        <Typography component="p">
          Mempool block explorer url (for the /{BotCommandName.Links} command):
          {' '}
          <ExternalLink
            href={data.mempoolUrlPrefix}
          >
            {data.mempoolUrlPrefix}
          </ExternalLink>
        </Typography>
        <Typography component="p" sx={{ flex: 1 }}>
          Bitcoind-Watcher queued tasks:
          {' '}
          {data.bitcoindWatcherTasks}
        </Typography>
        <Box>
          <Button
            variant="outlined"
            onClick={openEditing}
            sx={{ mt: 1 }}
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
        <FormLabel id="entry-restriction-label">Entry Restriction</FormLabel>
        <RadioGroup
          aria-labelledby="entry-restriction-label"
          value={entryRestriction}
          onChange={(_event, value) => {
            switch (value) {
              case EntryRestriction.UsersWhitelist:
                setEntryRestriction(EntryRestriction.UsersWhitelist);
                break;
              case EntryRestriction.MaxUsers:
                setEntryRestriction(EntryRestriction.MaxUsers);
                break;
              default:
                break;
            }
          }}
          name="entryRestriction"
        >
          <FormControlLabel
            value={EntryRestriction.UsersWhitelist}
            control={<Radio disabled={isMutationLoading} />}
            label={
              <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
                <Typography sx={{ width: 120 }}>Users whitelist:</Typography>
                <MuiChipsInput
                  ref={usersWhitelistRef}
                  disabled={
                    isMutationLoading || (entryRestriction !== EntryRestriction.UsersWhitelist)
                  }
                  clearInputOnBlur
                  value={entryRestriction === EntryRestriction.UsersWhitelist ? usersWhitelist : []}
                  onChange={updateUsersWhitelist}
                  onClick={() => setEntryRestriction(EntryRestriction.UsersWhitelist)}
                  addOnWhichKey={[' ', 'Enter']}
                  sx={{ minWidth: 420, maxWidth: 600 }}
                />
              </Box>
            }
          />
          <FormControlLabel
            value={EntryRestriction.MaxUsers}
            control={<Radio sx={{ mt: 2 }} disabled={isMutationLoading} />}
            sx={{ alignItems: 'start' }}
            label={
              <Box sx={{ display: 'flex', flexDirection: 'row' }}>
                <Typography sx={{ mt: 3, width: 120 }}>Max users:</Typography>
                <TextField
                  inputRef={maxUsersRef}
                  onClick={() => setEntryRestriction(EntryRestriction.MaxUsers)}
                  value={entryRestriction === EntryRestriction.MaxUsers ? maxUsers : ''}
                  onChange={updateMaxUsers}
                  required
                  margin="dense"
                  type="text"
                  inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
                  disabled={isMutationLoading || (entryRestriction !== EntryRestriction.MaxUsers)}
                  helperText={maxUsersTextFieldHelper}
                  sx={{ maxWidth: 420 }}
                  onKeyPress={preventEnter}
                />
              </Box>
            }
          />
        </RadioGroup>
        <FormLabel>Other</FormLabel>
        <Box>
          <FormControlLabel
            labelPlacement="start"
            name="mempoolUrlPrefix"
            control={
              <TextField
                disabled={isMutationLoading}
                sx={{ ml: 2, minWidth: 420 }}
                defaultValue={data.mempoolUrlPrefix}
                placeholder="e.g. https://mempool.space"
              />
            }
            label={`Mempool block explorer url (for the /{BotCommandName.Links} command):`}
          />
        </Box>
      </Box>
      <Box sx={{ mt: 2 }}>
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
