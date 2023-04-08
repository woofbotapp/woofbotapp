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

export enum WatchName {
  Reboot = 'reboot',
  Transaction = 'transaction',
  Addresses = 'addresses',
  PriceChange = 'price-change',
  NewBlocks = 'new-blocks',
  MempoolClear = 'mempool-clear',
  LightningChannelsOpened = 'lightning-channels-opened',
  LightningChannelsClosed = 'lightning-channels-closed',
  LightningForwards = 'lightning-forwards',
  LightningInvoicesCreated = 'lightning-invoices-created',
  LightningInvoicesPaid = 'lightning-invoices-paid',
}

export enum PermissionKey {
  WatchReboot = 'watchreboot',
  WatchNewBlocks = 'watchnewblocks',
  WatchTransaction = 'watchtransaction',
  WatchAddresses = 'watchaddresses',
  WatchPriceChange = 'watchpricechange',
  WatchMempoolClear = 'watchmempoolclear',
  WatchLightningChannelsOpened = 'watchlightningchannelsopened',
  WatchLightningChannelsClosed = 'watchlightningchannelsclosed',
  WatchLightningForwards = 'watchlightningforwards',
  WatchLightningInvoicesCreated = 'watchlightninginvoicescreated',
  WatchLightningInvoicesPaid = 'watchlightninginvoicespaid',
}

export interface Watch {
  name: WatchName;
  description: string;
  watchParametersRequestMessage?: string;
  unwatchParametersRequestMessage?: string;
  permissionKey?: PermissionKey;
}

export const watches: Watch[] = [
  {
    name: WatchName.Reboot,
    description: 'Get notifications when server reboots.',
    permissionKey: PermissionKey.WatchReboot,
  },
  {
    name: WatchName.Transaction,
    description: [
      'Get notifications when a transaction is found in the mempool, confirmed,',
      'or is being double-spent.',
    ].join(' '),
    watchParametersRequestMessage: [
      'Which transaction-id do you want to watch? You can specify only the id like:',
      '"a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d",',
      'or you can add a nickname like:',
      '"pizza_order:a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d".',
      'The nickname should not contain spaces.',
    ].join(' '),
    unwatchParametersRequestMessage: [
      'Which transaction-ids or nicknames of the transactions do you no longer want',
      'to watch? You can specify multiple values with spaces between them.',
      'You can also specify only the prefix, with a "*" at the end, like: "a1075db55d416d3c*".',
    ].join(' '),
    permissionKey: PermissionKey.WatchTransaction,
  },
  {
    name: WatchName.Addresses,
    description: [
      'Get notification when a transaction spending to the given addresses is added to the',
      'mempool or confirmed. Get notification when a transaction spending from the given',
      'addresses is confirmed (but not when it is only added to the mempool).',
    ].join(' '),
    watchParametersRequestMessage: [
      'Which addresses do you want to watch? You can specify only the address, like:',
      '"17SkEw2md5avVNyYgj6RiXuQKNwkXaxFyQ", or you can add a nickname like:',
      '"pizza_guy:17SkEw2md5avVNyYgj6RiXuQKNwkXaxFyQ".',
      'You can specify multiple values with spaces between them.',
      'The nicknames should not contain spaces.',
    ].join(' '),
    unwatchParametersRequestMessage: [
      'Which addresses or nicknames of addresses do you no longer want to watch?',
      'You can specify multiple values with spaces between them.',
      'You can also specify only the prefix, with a "*" at the end, like: "17SkEw2m*".',
    ].join(' '),
    permissionKey: PermissionKey.WatchAddresses,
  },
  {
    name: WatchName.PriceChange,
    description: 'Watch changes in the price of Bitcoin (in USD).',
    watchParametersRequestMessage: 'What price change (in USD) do you want to watch?',
    permissionKey: PermissionKey.WatchPriceChange,
  },
  {
    name: WatchName.NewBlocks,
    description: 'Get notifications when new blocks are mined.',
    permissionKey: PermissionKey.WatchNewBlocks,
  },
  {
    name: WatchName.MempoolClear,
    description: [
      'Get notifications when all the transactions in the mempool could fit in the next block',
      'and there is room for more, and when the mempool becomes full again.',
    ].join(' '),
    permissionKey: PermissionKey.WatchMempoolClear,
  },
  {
    name: WatchName.LightningChannelsOpened,
    description: 'Get notifications when lightning channels are opened.',
    permissionKey: PermissionKey.WatchLightningChannelsOpened,
  },
  {
    name: WatchName.LightningChannelsClosed,
    description: 'Get notifications when lightning channel are closed.',
    permissionKey: PermissionKey.WatchLightningChannelsClosed,
  },
  {
    name: WatchName.LightningForwards,
    description: 'Get notifications when lightning payments are forwarded through your node.',
    permissionKey: PermissionKey.WatchLightningForwards,
  },
  {
    name: WatchName.LightningInvoicesCreated,
    description: 'Get notifications when your node creates lightning invoices.',
    permissionKey: PermissionKey.WatchLightningInvoicesCreated,
  },
  {
    name: WatchName.LightningInvoicesPaid,
    description: 'Get notifications when your node\'s lightning invoices are paid.',
    permissionKey: PermissionKey.WatchLightningInvoicesPaid,
  },
];

export const watchByName = new Map(watches.map((watch) => [watch.name, watch]));

export enum BotCommandName {
  Start = 'start',
  Help = 'help',
  WhoAmI = 'whoami',
  Watch = 'watch',
  Unwatch = 'unwatch',
  Quit = 'quit',
  ListWatches = 'listwatches',
  Links = 'links',
}

export interface BotCommand {
  name: BotCommandName;
  description: string;
  permissionKey?: PermissionKey;
  parametersRequestMessage?: string;
}

export const telegramCommands: BotCommand[] = [
  {
    name: BotCommandName.Start,
    description: 'Registers to the server.',
  },
  {
    name: BotCommandName.Help,
    description: 'Shows help about available commands.',
  },
  {
    name: BotCommandName.Watch,
    description: 'Start getting notifications for events.',
  },
  {
    name: BotCommandName.Unwatch,
    description: 'Stop getting notifications for events.',
  },
  {
    name: BotCommandName.Links,
    description: [
      'Reply to a message with this command to receive links to the blocks, addresses and',
      'transactions that are mentioned in that message.',
    ].join(' '),
  },
  {
    name: BotCommandName.ListWatches,
    description: 'Lists all your configured watches.',
  },
  {
    name: BotCommandName.WhoAmI,
    description: 'Replies with your username and ids.',
  },
  {
    name: BotCommandName.Quit,
    description: 'Unregister from the server.',
  },
];

export const permissionGroupNameRegex = /^[a-z_]{1,100}$/;
