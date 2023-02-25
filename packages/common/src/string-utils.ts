export function mSatsToSats(mSats: string): string {
  const fraction = mSats.slice(-3).replace(/0+$/, '');
  return `${
    Number(mSats.slice(0, -3)).toLocaleString('en-US')
  }${fraction ? `.${fraction}` : ''}`;
}
