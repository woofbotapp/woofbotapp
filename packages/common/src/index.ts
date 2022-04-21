export const AppName = 'WoofBot';

export enum TelegramStatus {
  Unset = 'unset',
  Loading = 'loading',
  Failed = 'failed',
  Running = 'running',
}

export enum BotCommandName {
  Start = 'start',
  Help = 'help',
  WhoAmI = 'whoami',
  WatchReboot = 'watchreboot',
  UnwatchReboot = 'unwatchreboot',
  Quit = 'quit',
  WatchTransaction = 'watchtransaction',
  UnwatchTransactions = 'unwatchtransactions',
  Wtx = 'wtx',
  Uwtxs = 'uwtxs',
  ListWatches = 'listwatches',
  MempoolLinks = 'mempoollinks',
}

interface BotCommand {
  command: BotCommandName;
  description: string;
}

export const telegramCommands: BotCommand[] = [
  {
    command: BotCommandName.Start,
    description: 'Registers to the server.',
  },
  {
    command: BotCommandName.Help,
    description: 'Shows help about available commands.',
  },
  {
    command: BotCommandName.WhoAmI,
    description: 'Replies with your username and ids.',
  },
  {
    command: BotCommandName.WatchReboot,
    description: 'Get notifications when server reboots.',
  },
  {
    command: BotCommandName.UnwatchReboot,
    description: 'Stop getting notification when server reboots.',
  },
  {
    command: BotCommandName.WatchTransaction,
    description: [
      'Get notifications when a transaction is found in the mempool, confirmed,',
      'or is being double-spent.',
    ].join(' '),
  },
  {
    command: BotCommandName.Wtx,
    description: `Short for /${BotCommandName.WatchTransaction}.`,
  },
  {
    command: BotCommandName.UnwatchTransactions,
    description: 'Stop getting notifications about one or more transactions.',
  },
  {
    command: BotCommandName.Uwtxs,
    description: `Short for /${BotCommandName.UnwatchTransactions}.`,
  },
  {
    command: BotCommandName.MempoolLinks,
    description: [
      'Reply to a message with this command to receive links to the blocks, addresses and',
      'transactions that are mentioned in that message.',
    ].join(' '),
  },
  {
    command: BotCommandName.ListWatches,
    description: 'Lists all your configured watches.',
  },
  {
    command: BotCommandName.Quit,
    description: 'Unregister from the server.',
  },
];
