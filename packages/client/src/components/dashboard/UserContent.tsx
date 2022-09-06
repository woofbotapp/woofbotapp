import React, { useEffect } from 'react';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import CircularProgressIcon from '@mui/material/CircularProgress';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Typography from '@mui/material/Typography';
import { Link, useParams } from 'react-router-dom';

import { useUser, WatchedAddressAttributes, WatchedTransactionAttributes } from '../../api/users';
import { HttpError } from '../../utils/api';
import { errorToast } from '../../utils/toast';
import { pageRoutes } from '../../routes';
import Copyright from '../copyright/Copyright';
import Title from './Title';
import ExternalLink from '../external-link/ExternalLink';

const emptyTableCell = (
  <Typography component="span" variant="body2" color="text.secondary">
    -
  </Typography>
);

interface WatchedAddressRowProperties {
  watchedAddressAttributes?: WatchedAddressAttributes;
}

function WatchedAddressRow({
  watchedAddressAttributes,
}: WatchedAddressRowProperties) {
  if (!watchedAddressAttributes) {
    return (<></>);
  }
  return (
    <>
      <TableCell sx={{ wordBreak: 'break-all' }}>
        <ExternalLink
          href={
            `https://mempool.space/address/${
              encodeURIComponent(watchedAddressAttributes.address)
            }`
          }
        >
          {watchedAddressAttributes.address}
        </ExternalLink>
      </TableCell>
      <TableCell sx={{ wordBreak: 'break-all' }}>
        {
          watchedAddressAttributes.nickname ?? emptyTableCell
        }
      </TableCell>
      <TableCell>
        {watchedAddressAttributes.createdAt}
      </TableCell>
      <TableCell>
        {watchedAddressAttributes.updatedAt}
      </TableCell>
    </>
  );
}

WatchedAddressRow.defaultProps = {
  watchedAddressAttributes: undefined,
};

interface WatchedTransactionRowProperties {
  watchedTransactionAttributes?: WatchedTransactionAttributes;
}

function WatchedTransactionRow({
  watchedTransactionAttributes,
}: WatchedTransactionRowProperties) {
  if (!watchedTransactionAttributes) {
    return (<></>);
  }
  const blockHashes = watchedTransactionAttributes.blockHashes ?? [];
  const conflictingTransactions = watchedTransactionAttributes.conflictingTransactions ?? [];
  return (
    <>
      <TableCell sx={{ wordBreak: 'break-all' }}>
        <ExternalLink
          href={
            `https://mempool.space/tx/${encodeURIComponent(watchedTransactionAttributes.txid)}`
          }
        >
          {watchedTransactionAttributes.txid}
        </ExternalLink>
      </TableCell>
      <TableCell sx={{ wordBreak: 'break-all' }}>
        {
          watchedTransactionAttributes.nickname ?? emptyTableCell
        }
      </TableCell>
      <TableCell>
        {watchedTransactionAttributes.status}
      </TableCell>
      <TableCell sx={{ wordBreak: 'break-all' }}>
        {
          (blockHashes.length === 0) && emptyTableCell
        }
        {
          blockHashes.map((blockHash, index) => (
            <>
              <ExternalLink
                key={blockHash}
                href={`https://mempool.space/block/${encodeURIComponent(blockHash)}`}
              >
                {blockHash}
              </ExternalLink>
              {
                (index < blockHashes.length - 1) && ', '
              }
            </>
          ))
        }
      </TableCell>
      <TableCell>
        {watchedTransactionAttributes.confirmations}
      </TableCell>
      <TableCell sx={{ wordBreak: 'break-all' }}>
        {
          (conflictingTransactions.length === 0) && emptyTableCell
        }
        {
          conflictingTransactions.map((conflictingTransaction, index) => (
            <>
              <ExternalLink
                key={conflictingTransaction}
                href={`https://mempool.space/tx/${encodeURIComponent(conflictingTransaction)}`}
              >
                {conflictingTransaction}
              </ExternalLink>
              {
                (index < conflictingTransactions.length - 1) && ', '
              }
            </>
          ))
        }
      </TableCell>
      <TableCell>
        {watchedTransactionAttributes.createdAt}
      </TableCell>
      <TableCell>
        {watchedTransactionAttributes.updatedAt}
      </TableCell>
    </>
  );
}

WatchedTransactionRow.defaultProps = {
  watchedTransactionAttributes: undefined,
};

interface UserContentByUserIdProperties {
  userId: string;
}

function UserContentByUserId({
  userId,
}: UserContentByUserIdProperties) {
  const {
    data, error,
  } = useUser(userId);
  useEffect(() => {
    if (!error) {
      return;
    }
    errorToast(
      ((error instanceof HttpError) && error.message) || 'Internal error',
    );
  }, [error]);
  const watchedAddresses = data && new Map<string, WatchedAddressAttributes>(
    data.included.filter(
      (jsonApiData) => (jsonApiData.type === 'watched-addresses'),
    ).map((jsonApiData) => [jsonApiData.id, jsonApiData.attributes as WatchedAddressAttributes]),
  );
  const watchedTransactions = data && new Map<string, WatchedTransactionAttributes>(
    data.included.filter(
      (jsonApiData) => (jsonApiData.type === 'watched-transactions'),
    ).map((jsonApiData) => [jsonApiData.id,
      jsonApiData.attributes as WatchedTransactionAttributes]),
  );
  return (
    <>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Title>
            <Link to={pageRoutes.users}>
              <ArrowBackIcon sx={{ color: 'primary.main', mb: -0.5, mr: 1 }} />
            </Link>
            User
            {' '}
            {userId}
          </Title>
        </Grid>
        {
          !data && !error && (
            <CircularProgressIcon sx={{ margin: 'auto' }} />
          )
        }
        {
          (error instanceof HttpError) && (error.status === 404) && (
            <Grid item xs={12}>
              <Typography component="span" color="error">
                User not found
              </Typography>
            </Grid>
          )
        }
        {
          data && (
            <>
              <Grid item xs={12} md={6} lg={6}>
                <Paper
                  sx={{
                    p: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 140,
                  }}
                >
                  <Title>
                    Details
                  </Title>
                  <Typography component="p">
                    Telegram Username:
                    {' '}
                    <ExternalLink
                      href={
                        `https://t.me/${
                          encodeURIComponent(data.data.attributes.telegramUsername)
                        }`
                      }
                    >
                      @
                      {data.data.attributes.telegramUsername}
                    </ExternalLink>
                  </Typography>
                  <Typography component="p">
                    Telegram Id:
                    {' '}
                    {data.data.attributes.telegramFromId}
                    {
                      (data.data.attributes.telegramFromId !== data.data.attributes.telegramChatId)
                      && ` (${data.data.attributes.telegramChatId})`
                    }
                  </Typography>
                  <Typography component="p">
                    Created At:
                    {' '}
                    {data.data.attributes.createdAt}
                  </Typography>
                  <Typography component="p">
                    Updated At:
                    {' '}
                    {data.data.attributes.updatedAt}
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} md={6} lg={6}>
                <Paper
                  sx={{
                    p: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 167,
                  }}
                >
                  <Title>
                    Global Watches
                  </Title>
                  <Typography component="p">
                    Reboot:
                    {' '}
                    {data.data.attributes.watchReboot ? 'On' : 'Off'}
                  </Typography>
                  <Typography component="p">
                    New block minings:
                    {' '}
                    {data.data.attributes.watchNewBlocks ? 'On' : 'Off'}
                  </Typography>
                  <Typography component="p">
                    Watch price change:
                    {' '}
                    {
                      (data.data.attributes.watchPriceChange === undefined)
                        ? 'Off'
                        : `Every $${data.data.attributes.watchPriceChange.toLocaleString('en-US')}`
                    }
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={12}>
                <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column' }}>
                  <Title>
                    Watched Addresses
                  </Title>
                  {
                    (data.data.relationships.watchedAddresses.data.length === 0) && (
                      <Typography component="p">
                        No addresses were found
                      </Typography>
                    )
                  }
                  {
                    (data.data.relationships.watchedAddresses.data.length > 0) && (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Id</TableCell>
                            <TableCell>Address</TableCell>
                            <TableCell>Nickname</TableCell>
                            <TableCell>Created At</TableCell>
                            <TableCell>Updated At</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {
                            data.data.relationships.watchedAddresses.data.map((watchedAddress) => (
                              <TableRow key={watchedAddress.id}>
                                <TableCell sx={{ wordBreak: 'break-all' }}>
                                  {watchedAddress.id}
                                </TableCell>
                                <WatchedAddressRow
                                  watchedAddressAttributes={
                                    watchedAddresses?.get(watchedAddress.id)
                                  }
                                />
                              </TableRow>
                            ))
                          }
                        </TableBody>
                      </Table>
                    )
                  }
                </Paper>
              </Grid>
              <Grid item xs={12}>
                <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column' }}>
                  <Title>
                    Watched Transactions
                  </Title>
                  {
                    (data.data.relationships.watchedTransactions.data.length === 0) && (
                      <Typography component="p">
                        No transactions were found
                      </Typography>
                    )
                  }
                  {
                    (data.data.relationships.watchedTransactions.data.length > 0) && (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Id</TableCell>
                            <TableCell>Transaction Id</TableCell>
                            <TableCell>Nickname</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Block Hash</TableCell>
                            <TableCell>Confirmations</TableCell>
                            <TableCell>Conflicts</TableCell>
                            <TableCell>Created At</TableCell>
                            <TableCell>Updated At</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {
                            data.data.relationships.watchedTransactions.data.map(
                              (watchedTransaction) => (
                                <TableRow key={watchedTransaction.id}>
                                  <TableCell sx={{ wordBreak: 'break-all' }}>
                                    {watchedTransaction.id}
                                  </TableCell>
                                  <WatchedTransactionRow
                                    watchedTransactionAttributes={
                                      watchedTransactions?.get(watchedTransaction.id)
                                    }
                                  />
                                </TableRow>
                              ),
                            )
                          }
                        </TableBody>
                      </Table>
                    )
                  }
                </Paper>
              </Grid>
            </>
          )
        }
      </Grid>
      <Copyright />
    </>
  );
}

export default function UserContent() {
  const { userId } = useParams();
  if (!userId) {
    return (<>Invalid User Id</>);
  }
  return (
    <UserContentByUserId userId={userId} />
  );
}
