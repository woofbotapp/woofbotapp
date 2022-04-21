import React from 'react';
import Typography from '@mui/material/Typography';

import ExternalLink from '../external-link/ExternalLink';

const contactEmail = 'woofbot@protonmail.com';

export default function Copyright() {
  return (
    <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 8, mb: 4 }}>
      {'Copyright © '}
      <ExternalLink href="https://twitter.com/woofbotapp">
        WoofBot
      </ExternalLink>
      {' '}
      {new Date().getFullYear()}
      .
      <br />
      Your sponsorship can be here!
      <br />
      <ExternalLink href={`mailto:${contactEmail}`}>
        {contactEmail}
      </ExternalLink>
    </Typography>
  );
}
