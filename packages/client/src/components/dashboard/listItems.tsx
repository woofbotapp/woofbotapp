import React, { ReactNode } from 'react';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import { useResolvedPath, useLocation, Link } from 'react-router-dom';
import { pageRoutes } from '../../routes';

interface NavListItemButtonProps {
  icon: ReactNode;
  primary: string;
  to: string;
}

function NavListItemButton({ icon, primary, to }: NavListItemButtonProps) {
  const location = useLocation();
  const { pathname } = useResolvedPath(to);

  const isSelected = (pathname === location.pathname);

  return (
    <ListItemButton
      component={Link}
      to={to}
    >
      <ListItemIcon sx={{ color: isSelected ? 'primary.main' : '' }}>
        {icon}
      </ListItemIcon>
      <ListItemText primaryTypographyProps={{ color: isSelected ? 'primary.main' : '' }} primary={primary} />
    </ListItemButton>
  );
}

export const mainListItems = (
  <>
    <NavListItemButton icon={<DashboardIcon />} primary="Home" to={pageRoutes.home} />
    <NavListItemButton icon={<PeopleIcon />} primary="Users" to={pageRoutes.users} />
  </>
);
