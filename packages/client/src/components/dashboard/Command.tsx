import * as React from 'react';
import ListItem from '@mui/material/ListItem';
import Typography from '@mui/material/Typography';
import { BotCommandName, permissionGroupNameRegex } from '@woofbot/common';
import { MuiChipsInput } from 'mui-chips-input';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';

enum PermissionState {
  Anyone = 'anyone',
  ListedPermissionGroups = 'listedPermissionGroups',
}

export interface CommandProps {
  command: BotCommandName;
  description: string;
  originalPermissionGroups?: string[];
  permissionGroups?: string[];
  onChange?: (commandName: BotCommandName, value?: string[]) => void;
  disabled?: boolean;
}

export default function Command({
  command, description, originalPermissionGroups, permissionGroups, onChange, disabled,
}: CommandProps) {
  return (
    <ListItem
      className="bulletItem"
      classes={{ root: 'bulletItem' }}
    >
      <Typography
        component="span"
        variant="body2"
        sx={{
          backgroundColor: '#f2f2f2',
          color: '#333',
          fontFamily: 'Consolas, Monaco, \'Courier New\', monospace',
        }}
      >
        /{command}
        </Typography>
      <Typography component="span">
        {' - '}
        {description}
      </Typography>
      {
        onChange && (
          <Typography component="p" sx={{ pl: 2 }}>
            <RadioGroup
              value={
                permissionGroups ? PermissionState.ListedPermissionGroups : PermissionState.Anyone
              }
              onChange={(_event, value) => {
                switch (value) {
                  case PermissionState.Anyone:
                    onChange(command, undefined);
                    break;
                  case PermissionState.ListedPermissionGroups:
                    onChange(command, originalPermissionGroups ?? []);
                    break;
                  default:
                    break;
                }
              }}
            >
              <FormControlLabel
                value={PermissionState.Anyone}
                control={<Radio size="small" disabled={disabled} />}
                label={
                  <Typography variant="body2">
                    Any signed-in user can run this command.
                  </Typography>
                }
              />
              <FormControlLabel
                value={PermissionState.ListedPermissionGroups}
                control={<Radio size="small" disabled={disabled} />}
                label={
                  <Typography variant="body2">
                    Only users that belong to the following permission-groups can run this command
                    (leave empty to block everyone):
                  </Typography>
                }
              />
            </RadioGroup>
            <MuiChipsInput
              size="small"
              clearInputOnBlur
              value={permissionGroups ?? []}
              onChange={(value) => onChange(command, value)}
              addOnWhichKey={[' ', 'Enter']}
              validate={(value) => {
                if (!permissionGroupNameRegex.test(value)) {
                  return {
                    isError: true,
                    textError: 'Group names may contain only lowercase english letters and underscores',
                  };
                }
                return true;
              }}
              sx={{ width: '100%', pl: 3, pr: 3 }}
              disabled={disabled || !permissionGroups}
            />
          </Typography>
        )
      }
    </ListItem>
  );
}
