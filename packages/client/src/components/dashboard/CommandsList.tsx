import * as React from 'react';
import List from '@mui/material/List';
import { telegramCommands } from '@woofbot/common';

import Command from './Command';

export default function CommandsList() {
  return (
    <List dense sx={{ py: 0 }}>
      {
        telegramCommands.map(({ command, description }) => (
          <Command key={command} command={command} description={description} />
        ))
      }
    </List>
  );
}
