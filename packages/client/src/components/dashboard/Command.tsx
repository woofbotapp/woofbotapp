import * as React from 'react';
import ListItem from '@mui/material/ListItem';
import { BotCommandName } from '@woofbot/common';

export interface CommandProps {
  command: BotCommandName;
  description: string;
}

export default function Command({
  command, description,
}: CommandProps) {
  return (
    <ListItem
      className="bulletItem"
      classes={{ root: 'bulletItem' }}
    >
      /
      {command}
      {' - '}
      {description}
    </ListItem>
  );
}
