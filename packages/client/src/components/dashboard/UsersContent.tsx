import React, { useEffect, useState } from 'react';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import DeleteIcon from '@mui/icons-material/Delete';
import IconButton from '@mui/material/IconButton';
import CircularProgressIcon from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { Link } from 'react-router-dom';

import { useMutationDeleteUser, useUsers } from '../../api/users';
import { pageRoutes } from '../../routes';
import Copyright from '../copyright/Copyright';
import Title from './Title';

export default function UsersContent() {
  const {
    data, hasNextPage, fetchNextPage, isFetchingNextPage,
  } = useUsers();
  const [deleteUserId, setDeleteUserId] = useState<string | undefined>();
  const [promptDeleteUserId, setPromptDeleteUserId] = useState('');
  const { mutate: mutateDeleteUser } = useMutationDeleteUser();
  useEffect(() => {
    if (deleteUserId) {
      // keep the last defined id
      setPromptDeleteUserId(deleteUserId);
    }
  }, [deleteUserId]);
  const onDeleteClick = (event: React.MouseEvent<HTMLElement>) => {
    const userId = event.currentTarget.getAttribute('data-userid');
    setDeleteUserId(userId ?? undefined);
  };
  const deleteUser = () => {
    if (!deleteUserId) {
      return;
    }
    mutateDeleteUser({ id: deleteUserId });
    setDeleteUserId(undefined);
  };
  return (
    <>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column' }}>
            <Title>Users</Title>
            {
              !data && (
                <CircularProgressIcon sx={{ margin: 'auto' }} />
              )
            }
            {
              data && (data.pages.length === 0) && (
                <Typography component="p">
                  No users were found
                </Typography>
              )
            }
            {
              data && (data.pages.length > 0) && (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Id</TableCell>
                      <TableCell>Telegram Id</TableCell>
                      <TableCell>Telgram Username</TableCell>
                      <TableCell>Created At</TableCell>
                      <TableCell>Updated At</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {
                      data.pages.map((page) => (
                        <React.Fragment key={`${page.links.next}`}>
                          {
                            page.data.map(({ id, attributes }) => (
                              <TableRow key={id}>
                                <TableCell>
                                  <Typography
                                    component={Link}
                                    to={`${pageRoutes.users}/${encodeURIComponent(id)}`}
                                    color="primary"
                                  >
                                    {id}
                                  </Typography>
                                </TableCell>
                                <TableCell>
                                  {attributes.telegramFromId}
                                  {
                                    (attributes.telegramFromId !== attributes.telegramChatId)
                                    && ` (${attributes.telegramChatId})`
                                  }
                                </TableCell>
                                <TableCell>
                                  {attributes.telegramUsername}
                                </TableCell>
                                <TableCell>
                                  {attributes.createdAt}
                                </TableCell>
                                <TableCell>
                                  {attributes.updatedAt}
                                </TableCell>
                                <TableCell align="right">
                                  <IconButton
                                    onClick={onDeleteClick}
                                    data-userid={id}
                                    color="error"
                                  >
                                    <DeleteIcon />
                                  </IconButton>
                                </TableCell>
                              </TableRow>
                            ))
                          }
                        </React.Fragment>
                      ))
                    }
                  </TableBody>
                </Table>
              )
            }
            {
              hasNextPage && (
                <Box>
                  <Button
                    variant="text"
                    disabled={isFetchingNextPage}
                    onClick={() => fetchNextPage()}
                    sx={{ mt: 1 }}
                  >
                    See more users...
                  </Button>
                </Box>
              )
            }
          </Paper>
        </Grid>
      </Grid>
      <Copyright />
      <Dialog
        open={Boolean(deleteUserId)}
        onClose={() => setDeleteUserId(undefined)}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogTitle id="alert-dialog-title">
          Delete User
          {' '}
          {promptDeleteUserId}
          ?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="alert-dialog-description">
            Are you sure you want to delete this user?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Typography component="div" color="text.secondary">
            <Button
              onClick={() => setDeleteUserId(undefined)}
              color="inherit"
              variant="text"
              sx={{ mx: 1, my: 1 }}
            >
              Cancel
            </Button>
            <Button
              onClick={deleteUser}
              color="error"
              variant="contained"
              sx={{ mx: 1, my: 1 }}
            >
              Delete
            </Button>
          </Typography>
        </DialogActions>
      </Dialog>
    </>
  );
}
