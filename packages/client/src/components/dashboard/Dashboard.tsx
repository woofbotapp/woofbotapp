import React, { useState, MouseEvent } from 'react';
import { styled } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import MuiDrawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import MuiAppBar, { AppBarProps as MuiAppBarProps } from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import List from '@mui/material/List';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Container from '@mui/material/Container';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import CircularProgressIcon from '@mui/material/CircularProgress';
import { Link, Outlet } from 'react-router-dom';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Avatar from '@mui/material/Avatar';

import { mainListItems } from './listItems';
import { pageRoutes } from '../../routes';
import { useGetPing } from '../../api/ping';
import { isAuthError } from '../../utils/api';
import { ReactComponent as Logo } from '../../assets/images/logo.svg';

const drawerWidth: number = 240;

interface AppBarProps extends MuiAppBarProps {
  open?: boolean;
}

const AppBar = styled(MuiAppBar, {
  shouldForwardProp: (prop) => prop !== 'open',
})<AppBarProps>(({ theme, open }) => ({
  zIndex: theme.zIndex.drawer + 1,
  transition: theme.transitions.create(['width', 'margin'], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  ...(open && {
    marginLeft: drawerWidth,
    width: `calc(100% - ${drawerWidth}px)`,
    transition: theme.transitions.create(['width', 'margin'], {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen,
    }),
  }),
}));

const Drawer = styled(MuiDrawer, { shouldForwardProp: (prop) => prop !== 'open' })(
  ({ theme, open }) => ({
    '& .MuiDrawer-paper': {
      position: 'relative',
      whiteSpace: 'nowrap',
      width: drawerWidth,
      transition: theme.transitions.create('width', {
        easing: theme.transitions.easing.sharp,
        duration: theme.transitions.duration.enteringScreen,
      }),
      boxSizing: 'border-box',
      ...(!open && {
        overflowX: 'hidden',
        transition: theme.transitions.create('width', {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.leavingScreen,
        }),
        width: theme.spacing(7),
        [theme.breakpoints.up('sm')]: {
          width: theme.spacing(9),
        },
      }),
    },
  }),
);

export default function Dashboard() {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const toggleDrawer = () => {
    setIsDrawerOpen(!isDrawerOpen);
  };

  const [profileMenuAnchorEl, setProfileMenuAnchorEl] = useState<null | HTMLElement>(null);
  const isProfileMenuOpen = Boolean(profileMenuAnchorEl);
  const openProfileMenu = (event: MouseEvent<HTMLButtonElement>) => {
    setProfileMenuAnchorEl(event.currentTarget);
  };
  const closeProfileMenu = () => {
    setProfileMenuAnchorEl(null);
  };

  const ping = useGetPing();

  if (ping.isLoading || isAuthError(ping.error)) {
    return (
      <Box
        sx={{
          marginTop: 4,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <CircularProgressIcon color="inherit" size={24} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />
      <AppBar position="absolute" open={isDrawerOpen}>
        <Toolbar
          sx={{
            pr: '24px', // keep right padding when drawer closed
          }}
        >
          <IconButton
            edge="start"
            color="inherit"
            aria-label="open drawer"
            onClick={toggleDrawer}
            sx={{
              marginRight: '36px',
              ...(isDrawerOpen && { display: 'none' }),
            }}
          >
            <MenuIcon />
          </IconButton>
          <Typography
            component="h1"
            variant="h6"
            color="inherit"
            noWrap
            sx={{ flexGrow: 1 }}
          >
            WoofBot Dashboard - v0.1.0 (beta)
          </Typography>
          <IconButton
            color="inherit"
            id="profile-button"
            aria-controls={isProfileMenuOpen ? 'basic-menu' : undefined}
            aria-haspopup="true"
            aria-expanded={isProfileMenuOpen ? 'true' : undefined}
            onClick={openProfileMenu}
          >
            <Avatar sx={{ bgcolor: 'grey.100' }}>
              <Logo height="28px" />
            </Avatar>
          </IconButton>
          <Menu
            id="basic-menu"
            anchorEl={profileMenuAnchorEl}
            open={isProfileMenuOpen}
            onClose={closeProfileMenu}
            MenuListProps={{
              'aria-labelledby': 'basic-button',
            }}
          >
            <MenuItem component={Link} to={pageRoutes.logout}>Logout</MenuItem>
            <MenuItem component={Link} to={pageRoutes.changePassword}>Change Password</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>
      <Drawer variant="permanent" open={isDrawerOpen}>
        <Toolbar
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            px: [1],
          }}
        >
          <IconButton onClick={toggleDrawer}>
            <ChevronLeftIcon />
          </IconButton>
        </Toolbar>
        <Divider />
        <List component="nav">
          {mainListItems}
        </List>
      </Drawer>
      <Box
        component="main"
        sx={{
          backgroundColor: (theme) => (theme.palette.mode === 'light'
            ? theme.palette.grey[100]
            : theme.palette.grey[900]),
          flexGrow: 1,
          height: '100vh',
          overflow: 'auto',
        }}
      >
        <Toolbar />
        <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
          <Outlet />
        </Container>
      </Box>
    </Box>
  );
}
