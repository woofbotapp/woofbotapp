import * as React from 'react';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';

import Title from './Title';
import Commands from './Commands';
import Copyright from '../copyright/Copyright';
import TelegramSettings from './TelegramSettings';
import GeneralSettings from './GeneralSettings';

export default function HomeContent() {
  return (
    <>
      <Grid container spacing={3}>
        <Grid xs={0} md={1} lg={1} />
        <Grid item xs={12} md={10} lg={10}>
          <Paper
            sx={{
              p: 2,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Title>Telegram Settings</Title>
            <TelegramSettings />
          </Paper>
        </Grid>
        <Grid xs={0} md={1} lg={1} />
        <Grid xs={0} md={1} lg={1} />
        <Grid item xs={12} md={10} lg={10}>
          <Paper
            sx={{
              p: 2,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Title>General Settings and Stats</Title>
            <GeneralSettings />
          </Paper>
        </Grid>
        <Grid xs={0} md={1} lg={1} />
        <Grid xs={0} md={1} lg={1} />
        <Grid item xs={12} md={10} lg={10}>
          <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column' }}>
            <Title>Commands</Title>
            <Commands />
          </Paper>
        </Grid>
        <Grid xs={0} md={1} lg={1} />
      </Grid>
      <Copyright />
    </>
  );
}
