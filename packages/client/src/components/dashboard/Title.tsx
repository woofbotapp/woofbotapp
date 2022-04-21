import * as React from 'react';
import Typography from '@mui/material/Typography';

interface TitleProps {
  children?: React.ReactNode;
}

export default function Title({ children }: TitleProps) {
  return (
    <Typography component="h2" variant="h6" color="primary" gutterBottom>
      {children}
    </Typography>
  );
}

Title.defaultProps = {
  children: undefined,
};
