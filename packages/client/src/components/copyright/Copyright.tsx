import React from 'react';
import Typography from '@mui/material/Typography';

import ExternalLink from '../external-link/ExternalLink';

export default function Copyright() {
  return (
    <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 8, mb: 4 }}>
      {'Copyright © WoofBot '}
      {new Date().getFullYear()}
      .
      <br />
      <ExternalLink href="https://snort.social/p/woofbot%40protonmail.com.ln2.email">
        Nostr
      </ExternalLink>
      {' | '}
      <ExternalLink href="https://twitter.com/woofbotapp">
        Twitter
      </ExternalLink>
      {' | '}
      <ExternalLink href="mailto:woofbot@protonmail.com">
        Email
      </ExternalLink>
      <br />
      Your sponsorship can be here!
    </Typography>
  );
}
