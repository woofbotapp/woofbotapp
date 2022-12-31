import React, { useEffect, useState } from 'react';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import CircularProgressIcon from '@mui/material/CircularProgress';
import { useQueryClient } from 'react-query';
import { TelegramStatus } from '@woofbot/common';

import { useGetSettingsGeneral, useGetSettingsTelegram, useMutationSettingsTelegram } from '../../api/settings';
import { apiRoutes } from '../../routes';
import ExternalLink from '../external-link/ExternalLink';

const statusComponents = {
  [TelegramStatus.Unset]: (
    <Typography sx={{ fontWeight: 600 }}>
      A Telegram token must be set to allow responding to users&apos; commands.
    </Typography>
  ),
  [TelegramStatus.Loading]: (
    <>
      <Typography component="span">Status: </Typography>
      <Typography component="span" color="text.secondary">
        &#9679; Loading
      </Typography>
    </>
  ),
  [TelegramStatus.Failed]: (
    <>
      <Typography component="span">Status: </Typography>
      <Typography component="span" color="error.main">
        &#9679; Bad token or networking error
      </Typography>
    </>
  ),
  [TelegramStatus.Running]: (
    <>
      <Typography component="span">Status: </Typography>
      <Typography component="span" color="success.main">
        &#9679; Running
      </Typography>
    </>
  ),
};

const submitTimeoutMs = 5000;

enum TokenFormVisibility {
  Hide = 'hide',
  AreYouSure = 'areYouSure',
  Show = 'show',
}

export default function TelegramSettings() {
  const { data } = useGetSettingsTelegram();
  const { data: generalSettings } = useGetSettingsGeneral();
  const { mutate, isLoading: isMutationSettingsLoading } = useMutationSettingsTelegram();
  const [recentSubmit, setRecentSubmit] = useState(false);
  const [
    tokenFormVisibility, setTokenFormVisibility,
  ] = useState<TokenFormVisibility>(TokenFormVisibility.Hide);

  const queryClient = useQueryClient();
  const loadingRetryTimeoutMs = 5000;
  const finalTokenFormVisibility = (
    (data?.status !== TelegramStatus.Running) && (data?.numberOfUsers === 0)
  ) ? TokenFormVisibility.Show : tokenFormVisibility;

  useEffect(() => {
    if (data?.status !== TelegramStatus.Loading) {
      return undefined;
    }
    const timer = setTimeout(() => {
      queryClient.invalidateQueries(apiRoutes.settingsTelegram);
    }, loadingRetryTimeoutMs);
    return () => clearTimeout(timer);
  }, [queryClient, data]);

  useEffect(() => {
    if (!recentSubmit) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      setRecentSubmit(false);
    }, submitTimeoutMs);
    return () => clearTimeout(timeout);
  }, [recentSubmit, setRecentSubmit]);

  const handleChangeTokenClicked = () => {
    setTokenFormVisibility(
      (data?.numberOfUsers === 0) ? TokenFormVisibility.Show : TokenFormVisibility.AreYouSure,
    );
  };
  const handleYesClicked = () => setTokenFormVisibility(TokenFormVisibility.Show);
  const handleCancelClicked = () => setTokenFormVisibility(TokenFormVisibility.Hide);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    mutate({ token: `${formData.get('telegramToken')}` });
    setTokenFormVisibility(TokenFormVisibility.Hide);
    setRecentSubmit(true);
  };

  if (!data || !generalSettings || recentSubmit) {
    // Hide results when there was a recent submit, because it might be confusing to see
    // that the token was saved succesfully, but the telegram connection failed.
    return (
      <CircularProgressIcon sx={{ margin: 'auto' }} />
    );
  }

  return (
    <>
      <Typography component="p">
        {statusComponents[data.status]}
      </Typography>
      {data.botUsername && (
        <Typography component="p">
          Bot name:
          {' '}
          <ExternalLink
            href={`https://t.me/${encodeURIComponent(data.botUsername)}`}
          >
            @
            {data.botUsername}
            {' - '}
            {data.botName}
          </ExternalLink>
        </Typography>
      )}
      {(finalTokenFormVisibility === TokenFormVisibility.Hide) && (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Typography color="text.secondary" variant="body2">
            To use the bot, start a chat and call the &quot;/start&quot; command.
          </Typography>
          <Typography sx={{ flex: 1 }}>
            Number of users:
            {' '}
            {data.numberOfUsers}
            {
              (generalSettings.maxUsers !== undefined)
              && (data.numberOfUsers >= generalSettings.maxUsers) && (
                ' - max-users was reached'
              )
            }
          </Typography>
          <Box sx={{ mt: 1 }}>
            <Button
              variant="outlined"
              onClick={handleChangeTokenClicked}
            >
              Change Token
            </Button>
          </Box>
        </Box>
      )}
      {(finalTokenFormVisibility === TokenFormVisibility.AreYouSure) && (
        <Box
          sx={{ mt: 1 }}
        >
          <Typography variant="body2" color="warning.main">
            It seems that there are existing users in your database.
            <br />
            If you are only updating the token of an existing bot, that&apos;s ok.
            <br />
            If you are switching to a new bot, please remove all existing users first.
            <br />
            Continue without removing users?
          </Typography>
          <Box flexDirection="row" sx={{ mt: 1 }}>
            <Button
              variant="contained"
              onClick={handleYesClicked}
            >
              Yes
            </Button>
            <Button
              sx={{ ml: 1 }}
              variant="outlined"
              onClick={handleCancelClicked}
            >
              Cancel
            </Button>
          </Box>
        </Box>
      )}
      {(finalTokenFormVisibility === TokenFormVisibility.Show) && (
        <>
          <Box
            component="form"
            noValidate
            onSubmit={handleSubmit}
            sx={{ display: 'flex', flexDirection: 'row', mt: 1 }}
          >
            <TextField
              required
              margin="dense"
              name="telegramToken"
              label="Telegram Token"
              type="password"
              id="telegramToken"
              sx={{ flex: 1 }}
              disabled={isMutationSettingsLoading}
            />
            <Button
              type="submit"
              variant="contained"
              sx={{
                my: 2, ml: 1, flex: 0,
              }}
              disabled={isMutationSettingsLoading}
            >
              Save
            </Button>
            {
              (data.status === TelegramStatus.Running) && (
                <Button
                  type="reset"
                  variant="outlined"
                  color="primary"
                  sx={{
                    my: 2, ml: 1, flex: 0, px: 5,
                  }}
                  disabled={isMutationSettingsLoading}
                  onClick={handleCancelClicked}
                >
                  Cancel
                </Button>
              )
            }
          </Box>
          <Typography color="text.secondary" variant="body2">
            To create a new Telegram Bot token, start a chat with Telegram&apos;s official
            {' '}
            <ExternalLink href="https://t.me/botfather">
              @BotFather
            </ExternalLink>
            {' '}
            bot and call the &quot;/newbot&quot; command.
          </Typography>
        </>
      )}
    </>
  );
}
