import React, { useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { useMutationImportConfiguration } from '../../api/settings';
import { apiRoutes } from '../../routes';
import { api, HttpError } from '../../utils/api';
import { errorToast } from '../../utils/toast';

export default function ConfigurationBackup() {
  const [isExporting, setIsExporting] = useState(false);
  const [isConfirmingImport, setIsConfirmingImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { mutate, isLoading: isImporting } = useMutationImportConfiguration();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const configuration = await api.get(apiRoutes.configuration);
      const blob = new Blob(
        [JSON.stringify(configuration, null, 2)],
        { type: 'application/json' },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `woofbot-configuration-${
        new Date().toISOString().replace(/[:.]/g, '-')
      }.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      errorToast(
        ((error instanceof HttpError) && error.message) || 'Failed to export the configuration',
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportClicked = () => setIsConfirmingImport(true);
  const handleCancelClicked = () => setIsConfirmingImport(false);
  const handleChooseFileClicked = () => fileInputRef.current?.click();

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) {
      // Allow selecting the same file again next time.
      fileInputRef.current.value = '';
    }
    if (!file) {
      return;
    }
    setIsConfirmingImport(false);
    let configuration;
    try {
      configuration = JSON.parse(await file.text());
    } catch (error) {
      errorToast('The selected file is not a valid JSON file');
      return;
    }
    mutate(configuration);
  };

  return (
    <>
      <Typography component="p">
        Export all of the bot&apos;s configuration (Telegram token, general settings, command
        permissions, users and their watches) to a JSON file, or restore it from a previously
        exported file. The admin password is not included.
      </Typography>
      <input
        type="file"
        accept="application/json,.json"
        ref={fileInputRef}
        onChange={handleFileSelected}
        style={{ display: 'none' }}
      />
      {isConfirmingImport ? (
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" color="warning.main">
            Warning: importing a configuration file will delete and override ALL of the existing
            configuration, including the Telegram token, general settings, command permissions,
            and all users with their watches.
            <br />
            This cannot be undone. It is recommended to export the current configuration first.
            <br />
            Continue?
          </Typography>
          <Box flexDirection="row" sx={{ mt: 1 }}>
            <Button
              variant="contained"
              color="error"
              onClick={handleChooseFileClicked}
              disabled={isImporting}
            >
              Yes, choose a file
            </Button>
            <Button
              sx={{ ml: 1 }}
              variant="outlined"
              onClick={handleCancelClicked}
              disabled={isImporting}
            >
              Cancel
            </Button>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="row" sx={{ mt: 1 }}>
          <Button
            variant="outlined"
            onClick={handleExport}
            disabled={isExporting || isImporting}
          >
            Export Configuration
          </Button>
          <Button
            sx={{ ml: 1 }}
            variant="outlined"
            onClick={handleImportClicked}
            disabled={isExporting || isImporting}
          >
            Import Configuration
          </Button>
        </Box>
      )}
    </>
  );
}
