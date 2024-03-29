import React, { useState, useEffect } from 'react';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import Typography from '@mui/material/Typography';
import { PermissionKey, telegramCommands, watches } from '@woofbot/common';

import {
  useGetSettingsCommandsPermissionGroups, useMutationCommandsPermissionGroups,
} from '../../api/settings';
import { arraysEqual } from '../../utils/array-utils';
import Command from './Command';
import Title from './Title';

export default function CommandsList() {
  const {
    data: originalPermissionGroups,
    isLoading: isDataLoading,
  } = useGetSettingsCommandsPermissionGroups();
  const [permissionGroups, setPermissionGroups] = useState<
    Partial<Record<PermissionKey, string[]>> | undefined
  >(undefined);
  const {
    isLoading: isMutationLoading,
    mutate: mutateCommandsPermissionGroups,
  } = useMutationCommandsPermissionGroups();
  const onChangePermissionGroups = (permissionKey: PermissionKey, value?: string[]) => {
    const newPermissionGroups = {
      ...(permissionGroups ?? originalPermissionGroups),
    };
    if (value) {
      newPermissionGroups[permissionKey] = value;
    } else {
      delete newPermissionGroups[permissionKey];
    }
    setPermissionGroups(newPermissionGroups);
  };
  useEffect(() => {
    if (!originalPermissionGroups || !permissionGroups) {
      return;
    }
    if (Object.values(PermissionKey).some(
      (permissionKey) => {
        const commandPermissionGroups = originalPermissionGroups[permissionKey];
        const commandPatchedPermissionGroups = permissionGroups[permissionKey];
        return (
          Boolean(commandPermissionGroups) !== Boolean(commandPatchedPermissionGroups)
          || (
            commandPermissionGroups && commandPatchedPermissionGroups
            && !arraysEqual(commandPermissionGroups, commandPatchedPermissionGroups)
          )
        );
      },
    )) {
      return;
    }
    setPermissionGroups(undefined);
  }, [originalPermissionGroups, permissionGroups]);
  const isLoading = isDataLoading || isMutationLoading;
  return (
    <>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}
      >
        <Box>
          <Title>Commands</Title>
        </Box>
        <Box
            sx={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'flex-end',
              gap: 2,
            }}
          >
            <Box>
              <Button
                variant="outlined"
                disabled={isLoading || permissionGroups === undefined}
                onClick={() => setPermissionGroups({})}
              >
                Cancel
              </Button>
            </Box>
            <Box>
              <Button
                variant="contained"
                disabled={isLoading || permissionGroups === undefined}
                onClick={() => {
                  if (permissionGroups) {
                    mutateCommandsPermissionGroups(permissionGroups);
                  }
                }}
              >
                Save
              </Button>
            </Box>
          </Box>
      </Box>
      <List dense sx={{ py: 0 }}>
        {
          telegramCommands.map(({ name, description, permissionKey }) => (
            <Command
              key={name}
              command={`/${name}`}
              permissionKey={permissionKey}
              description={description}
              permissionGroups={
                permissionKey && (permissionGroups ?? originalPermissionGroups)?.[permissionKey]
              }
              onChange={onChangePermissionGroups}
              disabled={isLoading}
              originalPermissionGroups={
                permissionKey && originalPermissionGroups?.[permissionKey]
              }
            />
          ))
        }
      </List>
      <Typography component="p" sx={{ mt: 1 }}>
        Here are the events that you can watch:
      </Typography>
      <List dense sx={{ py: 0 }}>
        {
          watches.map(({ name, description, permissionKey }) => (
            <Command
              key={name}
              command={`/watch ${name}`}
              permissionKey={permissionKey}
              description={description}
              permissionGroups={
                permissionKey && (permissionGroups ?? originalPermissionGroups)?.[permissionKey]
              }
              onChange={onChangePermissionGroups}
              disabled={isLoading}
              originalPermissionGroups={
                permissionKey && originalPermissionGroups?.[permissionKey]
              }
            />
          ))
        }
      </List>
    </>
  );
}
