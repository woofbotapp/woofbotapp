import React, { useState, useEffect } from 'react';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import { BotCommandName, telegramCommands } from '@woofbot/common';

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
    Partial<Record<BotCommandName, string[]>> | undefined
  >(undefined);
  const {
    isLoading: isMutationLoading,
    mutate: mutateCommandsPermissionGroups,
  } = useMutationCommandsPermissionGroups();
  const onChangePermissionGroups = (command: BotCommandName, value?: string[]) => {
    const newPermissionGroups = {
      ...(permissionGroups ?? originalPermissionGroups),
    };
    if (value) {
      newPermissionGroups[command] = value;
    } else {
      delete newPermissionGroups[command];
    }
    setPermissionGroups(newPermissionGroups);
  };
  useEffect(() => {
    if (!originalPermissionGroups || !permissionGroups) {
      return;
    }
    if (telegramCommands.some(
      ({ name }) => {
        const commandPermissionGroups = originalPermissionGroups[name];
        const commandPatchedPermissionGroups = permissionGroups[name];
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
          telegramCommands.map(({ name, description, alwaysPermitted }) => (
            <Command
              key={name}
              command={name}
              description={description}
              permissionGroups={(permissionGroups ?? originalPermissionGroups)?.[name]}
              onChange={
                alwaysPermitted ? undefined : onChangePermissionGroups
              }
              disabled={isLoading}
              originalPermissionGroups={originalPermissionGroups?.[name]}
            />
          ))
        }
      </List>
    </>
  );
}
