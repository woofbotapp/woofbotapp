import * as React from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';

import { telegramCommands } from '@woofbot/common';

export default function Commands() {
  return (
    <List dense sx={{ py: 0 }}>
      {
        telegramCommands.map(({ command, description }) => (
          <ListItem
            key={command}
            className="bulletItem"
            classes={{ root: 'bulletItem' }}
          >
            /
            {command}
            {' - '}
            {description}
          </ListItem>
        ))
      }
    </List>
  );
}
