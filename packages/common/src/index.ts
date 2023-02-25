export { prettyDate } from './date-utils';
export { mSatsToSats } from './string-utils';

export const AppName = 'WoofBot';

export const AppVersion = '%VERSION%'; // will be replaced by post-build script

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
  WatchAddresses = 'watchaddresses',
  UnwatchAddresses = 'unwatchaddresses',
  WatchPriceChange = 'watchpricechange',
  UnwatchPriceChange = 'unwatchpricechange',
  WatchNewBlocks = 'watchnewblocks',
  UnwatchNewBlocks = 'unwatchnewblocks',
  WatchMempoolClear = 'watchmempoolclear',
  UnwatchMempoolClear = 'unwatchmempoolclear',
  WatchLightningChannelsOpened = 'watchlightningchannelsopened',
  UnwatchLightningChannelsOpened = 'unwatchlightningchannelsopened',
  WatchLightningChannelsClosed = 'watchlightningchannelsclosed',
  UnwatchLightningChannelsClosed = 'unwatchlightningchannelsclosed',
  WatchLightningForwards = 'watchlightningforwards',
  UnwatchLightningForwards = 'unwatchlightningforwards',
  ListWatches = 'listwatches',
  Links = 'links',
}

export interface BotCommand {
  name: BotCommandName;
  description: string;
  alwaysPermitted: boolean;
  parametersRequestMessage?: string;
}

export const telegramCommands: BotCommand[] = [
  {
    name: BotCommandName.Start,
    description: 'Registers to the server.',
    alwaysPermitted: true,
  },
  {
    name: BotCommandName.Help,
    description: 'Shows help about available commands.',
    alwaysPermitted: true,
  },
  {
    name: BotCommandName.WhoAmI,
    description: 'Replies with your username and ids.',
    alwaysPermitted: true,
  },
  {
    name: BotCommandName.WatchReboot,
    description: 'Get notifications when server reboots.',
    alwaysPermitted: false,
  },
  {
    name: BotCommandName.UnwatchReboot,
    description: 'Stop getting notification when server reboots.',
    alwaysPermitted: true,
  },
  {
    name: BotCommandName.WatchNewBlocks,
    description: 'Get notifications new blocks are mined.',
    alwaysPermitted: false,
  },
  {
    name: BotCommandName.UnwatchNewBlocks,
    description: 'Stop getting notification when new blocks are mined.',
    alwaysPermitted: true,
  },
  {
    name: BotCommandName.WatchTransaction,
    description: [
      'Get notifications when a transaction is found in the mempool, confirmed,',
      'or is being double-spent.',
    ].join(' '),
    alwaysPermitted: false,
    parametersRequestMessage: [
      'Which transaction-id do you want to watch? You can specify only the id like:',
      '"a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d",',
      'or you can add a nickname like:',
      '"pizza_order:a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d".',
      'The nickname should not contain spaces.',
    ].join(' '),
  },
  {
    name: BotCommandName.UnwatchTransactions,
    description: 'Stop getting notifications about one or more transactions.',
    alwaysPermitted: true,
    parametersRequestMessage: [
      'Which transaction-ids or nicknames of the transactions do you no longer want',
      'to watch? You can specify multiple values with spaces between them.',
      'You can also specify only the prefix, with a "*" at the end, like: "a1075db55d416d3c*".',
    ].join(' '),
  },
  {
    name: BotCommandName.WatchAddresses,
    description: [
      'Get notification when a transaction spending to the given addresses is added to the',
      'mempool or confirmed. Get notification when a transaction spending from the given',
      'addresses is confirmed (but not when it is only added to the mempool).',
    ].join(' '),
    alwaysPermitted: false,
    parametersRequestMessage: [
      'Which addresses do you want to watch? You can specify only the address, like:',
      '"17SkEw2md5avVNyYgj6RiXuQKNwkXaxFyQ", or you can add a nickname like:',
      '"pizza_guy:17SkEw2md5avVNyYgj6RiXuQKNwkXaxFyQ".',
      'You can specify multiple values with spaces between them.',
      'The nicknames should not contain spaces.',
    ].join(' '),
  },
  {
    name: BotCommandName.UnwatchAddresses,
    description: 'Stop getting notifications about one or more addresses.',
    alwaysPermitted: true,
    parametersRequestMessage: [
      'Which addresses or nicknames of addresses do you no longer want to watch?',
      'You can specify multiple values with spaces between them.',
      'You can also specify only the prefix, with a "*" at the end, like: "17SkEw2m*".',
    ].join(' '),
  },
  {
    name: BotCommandName.WatchPriceChange,
    description: 'Watch changes in the price of Bitcoin (in USD).',
    alwaysPermitted: false,
    parametersRequestMessage: 'What price change (in USD) do you want to watch?',
  },
  {
    name: BotCommandName.UnwatchPriceChange,
    description: 'Stop getting notifications about changes in the price of Bitcoin.',
    alwaysPermitted: true,
  },
  {
    name: BotCommandName.WatchMempoolClear,
    description: [
      'Get notification when all the transactions in the mempool could fit in the next block and',
      'there is room for more, and when the mempool becomes full again.',
    ].join(' '),
    alwaysPermitted: false,
  },
  {
    name: BotCommandName.UnwatchMempoolClear,
    description: `Stop getting notifications of /${BotCommandName.WatchMempoolClear}.`,
    alwaysPermitted: true,
  },
  {
    name: BotCommandName.WatchLightningChannelsOpened,
    description: 'Get notification when a lightning channel is opened.',
    alwaysPermitted: false,
  },
  {
    name: BotCommandName.UnwatchLightningChannelsOpened,
    description: `Stop getting notifications of /${BotCommandName.WatchLightningChannelsOpened}.`,
    alwaysPermitted: true,
  },
  {
    name: BotCommandName.WatchLightningChannelsClosed,
    description: 'Get notification when a lightning channel is closed.',
    alwaysPermitted: false,
  },
  {
    name: BotCommandName.UnwatchLightningChannelsClosed,
    description: `Stop getting notifications of /${BotCommandName.WatchLightningChannelsClosed}.`,
    alwaysPermitted: true,
  },
  {
    name: BotCommandName.WatchLightningForwards,
    description: 'Get notification when a lightning payment is forwarded through your node.',
    alwaysPermitted: false,
  },
  {
    name: BotCommandName.UnwatchLightningForwards,
    description: `Stop getting notifications of /${BotCommandName.WatchLightningForwards}.`,
    alwaysPermitted: true,
  },
  {
    name: BotCommandName.Links,
    description: [
      'Reply to a message with this command to receive links to the blocks, addresses and',
      'transactions that are mentioned in that message.',
    ].join(' '),
    alwaysPermitted: true,
  },
  {
    name: BotCommandName.ListWatches,
    description: 'Lists all your configured watches.',
    alwaysPermitted: true,
  },
  {
    name: BotCommandName.Quit,
    description: 'Unregister from the server.',
    alwaysPermitted: true,
  },
];

export const permissionGroupNameRegex = /^[a-z_]{1,100}$/;
