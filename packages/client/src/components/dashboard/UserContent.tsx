import React, { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
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
import { permissionGroupNameRegex } from '@woofbot/common';
import { MuiChipsInput } from 'mui-chips-input';
import { Link, useParams } from 'react-router-dom';

import {
  useMutationPatchUser, useUser, WatchedAddressAttributes, WatchedTransactionAttributes,
  UserPatch,
} from '../../api/users';
import { HttpError } from '../../utils/api';
import { prettyDate } from '../../utils/date-utils';
import { errorToast } from '../../utils/toast';
import { pageRoutes } from '../../routes';
import Copyright from '../copyright/Copyright';
import Title from './Title';
import { emptyTableCell } from './emptyTableCell';
import ExternalLink from '../external-link/ExternalLink';
import { useGetSettingsGeneral } from '../../api/settings';

interface WatchedAddressRowProperties {
  watchedAddressAttributes?: WatchedAddressAttributes;
  mempoolUrlPrefix?: string;
}

function WatchedAddressRow({
  watchedAddressAttributes,
  mempoolUrlPrefix,
}: WatchedAddressRowProperties) {
  if (!watchedAddressAttributes) {
    return null;
  }
  return (
    <>
      <TableCell sx={{ wordBreak: 'break-all' }}>
        <ExternalLink
          href={
            `${mempoolUrlPrefix}/address/${
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
        {prettyDate(watchedAddressAttributes.createdAt)}
      </TableCell>
      <TableCell>
        {prettyDate(watchedAddressAttributes.updatedAt)}
      </TableCell>
    </>
  );
}

WatchedAddressRow.defaultProps = {
  watchedAddressAttributes: undefined,
};

interface WatchedTransactionRowProperties {
  watchedTransactionAttributes?: WatchedTransactionAttributes;
  mempoolUrlPrefix: string;
}

function WatchedTransactionRow({
  watchedTransactionAttributes,
  mempoolUrlPrefix,
}: WatchedTransactionRowProperties) {
  if (!watchedTransactionAttributes) {
    return null;
  }
  const blockHashes = watchedTransactionAttributes.blockHashes ?? [];
  const conflictingTransactions = watchedTransactionAttributes.conflictingTransactions ?? [];
  return (
    <>
      <TableCell sx={{ wordBreak: 'break-all' }}>
        <ExternalLink
          href={
            `${mempoolUrlPrefix}/tx/${encodeURIComponent(watchedTransactionAttributes.txid)}`
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
                href={`${mempoolUrlPrefix}/block/${encodeURIComponent(blockHash)}`}
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
                href={`${mempoolUrlPrefix}/tx/${encodeURIComponent(conflictingTransaction)}`}
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
        {prettyDate(watchedTransactionAttributes.createdAt)}
      </TableCell>
      <TableCell>
        {prettyDate(watchedTransactionAttributes.updatedAt)}
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
  const { data: generalSettings } = useGetSettingsGeneral();
  const [patchData, setPatchData] = useState<Omit<UserPatch, 'id'>>({});
  const { mutate: mutatePatchUser, isLoading: isMutationLoading } = useMutationPatchUser();
  useEffect(() => {
    if (!error) {
      return;
    }
    errorToast(
      ((error instanceof HttpError) && error.message) || 'Internal error',
    );
  }, [error]);
  useEffect(() => {
    const patchDataPermissionGroups = patchData.permissionGroups;
    if (!data || !patchDataPermissionGroups) {
      return;
    }
    const { permissionGroups } = data.data.attributes;
    if (permissionGroups.length === patchDataPermissionGroups.length
      && permissionGroups.every((group, index) => group === patchDataPermissionGroups[index])
    ) {
      const newPatchData = { ...patchData };
      delete newPatchData.permissionGroups;
      setPatchData(newPatchData);
    }
  }, [data, patchData]);
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
  const attributes = data && data.data.attributes;
  const hasChanges = Object.keys(patchData).length > 0;
  return (
    <>
      <Grid container spacing={3}>
        <Grid item xs={10}>
          <Title>
            <Link to={pageRoutes.users}>
              <ArrowBackIcon sx={{ color: 'primary.main', mb: -0.5, mr: 1 }} />
            </Link>
            User
            {' '}
            {userId}
          </Title>
        </Grid>
        <Grid item xs={2}>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'flex-end',
              gap: 2,
            }}
          >
            <Box>
              <Button
                variant="outlined"
                disabled={isMutationLoading || !hasChanges}
                onClick={() => setPatchData({})}
              >
                Cancel
              </Button>
            </Box>
            <Box>
              <Button
                variant="contained"
                disabled={isMutationLoading || !hasChanges}
                onClick={() => {
                  mutatePatchUser({ id: userId, ...patchData });
                }}
              >
                Save
              </Button>
            </Box>
          </Box>
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
          attributes && (
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
                          encodeURIComponent(attributes.telegramUsername)
                        }`
                      }
                    >
                      @
                      {attributes.telegramUsername}
                    </ExternalLink>
                  </Typography>
                  <Typography component="p">
                    Telegram Id:
                    {' '}
                    {attributes.telegramFromId}
                    {
                      (attributes.telegramFromId !== attributes.telegramChatId)
                      && ` (${attributes.telegramChatId})`
                    }
                  </Typography>
                  <Typography component="p">
                    Created At:
                    {' '}
                    {prettyDate(attributes.createdAt)}
                  </Typography>
                  <Typography component="p">
                    Updated At:
                    {' '}
                    {prettyDate(attributes.updatedAt)}
                  </Typography>
                  <Typography component="p">
                    Permission Groups:
                  </Typography>
                  <Typography component="p">
                    <MuiChipsInput
                      size="small"
                      clearInputOnBlur
                      value={patchData.permissionGroups ?? data.data.attributes.permissionGroups}
                      onChange={(value) => {
                        setPatchData({
                          ...patchData,
                          permissionGroups: value,
                        });
                      }}
                      addOnWhichKey={[' ', 'Enter']}
                      validate={(value) => {
                        if (!permissionGroupNameRegex.test(value)) {
                          return {
                            isError: true,
                            textError: 'Group names may contain only lowercase english letters and underscores',
                          };
                        }
                        return true;
                      }}
                      sx={{ width: '100%', pl: 1 }}
                    />
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
                  <Typography component="p">
                    Watch mempool clear:
                    {' '}
                    {data.data.attributes.watchMempoolClear ? 'On' : 'Off'}
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
                                  mempoolUrlPrefix={generalSettings?.mempoolUrlPrefix ?? ''}
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
                                    mempoolUrlPrefix={generalSettings?.mempoolUrlPrefix ?? ''}
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
