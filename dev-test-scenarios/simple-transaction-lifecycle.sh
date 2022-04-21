#!/bin/bash

${BASH_SOURCE%/*}/requirements.sh

echo "Mining 251 blocks (without reusing addresses)"
for index in {1..251}
do
  if (( $index % 10 == 0 ))
  then
    echo "block $index"
  fi
  bitcoin-cli generatetoaddress 1 `bitcoin-cli getnewaddress` > /dev/null
done

echo "Broadcasting 100 transactions to have a non-empty mempool"
for index in {1..100}
do
  if (( $index % 10 == 0 ))
  then
    echo "broadcast $index"
  fi
  bitcoin-cli sendtoaddress `bitcoin-cli getnewaddress` 0.001 > /dev/null
done
echo "Mempool Info:"
bitcoin-cli getmempoolinfo

all_unspent=`bitcoin-cli listunspent 1 9999999 [] true '{"minimumAmount":0.00001001}' | jq -rc '. | sort_by(-.amount)'`
echo "Number of utxos: `echo $all_unspent | jq '. | length'`"
unspent=`echo $all_unspent | jq -rc '.[0]'`
all_unspent=`echo $all_unspent | jq -rc '.[1:]'`
if [ -z "$unspent" ] || [ "null" = "$unspent" ]
then
  echo "Could not find any UTXO with more than 0.002 BTC"
  exit 1
fi
echo "UTXO:"
jq -n --argjson unspent $unspent '$unspent | .'

source_address=`jq -nr --argjson unspent $unspent '$unspent | .address'`
echo ""
echo "Source Address: $source_address"
qrencode -t ansiutf8 $source_address
echo ""

target_address=`bitcoin-cli getnewaddress`
echo ""
echo "Target Address: $target_address"
qrencode -t ansiutf8 $target_address
echo ""

source_txid=`jq -nr --argjson unspent $unspent '$unspent | .txid'`
source_vout=`jq -nr --argjson unspent $unspent '$unspent | .vout'`
# 500 sats fee
unspent_amount=`jq -nr --argjson unspent $unspent '$unspent | (.amount * 100000000 - 500) / 100000000'`
tx_input=`jq -n -c --arg txid $source_txid --arg vout $source_vout '[{"txid": $txid, "vout": $vout|tonumber}]'`
tx_output=`jq -n -c --arg address $target_address --arg amount $unspent_amount '{($address): $amount|tonumber}'`
echo "Creating Transaction $tx_input -> $tx_output"
transaction=`bitcoin-cli createrawtransaction $tx_input $tx_output`
echo "Signing Transaction"
signed_transaction=`bitcoin-cli signrawtransactionwithwallet $transaction | jq -r '.hex'`
echo "Signed Transaction hex: $signed_transaction"
txid=`bitcoin-cli decoderawtransaction $signed_transaction | jq -r '.txid'`

echo ""
echo "Transaction Id: $txid"
qrencode -t ansiutf8 $txid
echo ""

echo "Press Enter to broadcast 25 unrelated transactions"
read
for index in {1..25}
do
  stub_target_address=`bitcoin-cli getnewaddress`
  stub_unspent=`echo $all_unspent | jq -rc '.[0]'`
  all_unspent=`echo $all_unspent | jq -rc '.[1:]'`
  stub_unspent_txid=`jq -nr --argjson unspent $stub_unspent '$unspent | .txid'`
  stub_unspent_vout=`jq -nr --argjson unspent $stub_unspent '$unspent | .vout'`
  # 1000 sats fee
  stub_unspent_amount=`jq -nr --argjson unspent $stub_unspent '$unspent | (.amount * 100000000 - 1000) / 100000000'`
  stub_tx_input=`jq -nc --arg txid $stub_unspent_txid --arg vout $stub_unspent_vout '[{"txid": $txid, "vout": $vout|tonumber}]'`
  stub_tx_output=`jq -nc --arg address $stub_target_address --arg amount $stub_unspent_amount '{($address): $amount|tonumber}'`
  echo "Creating Stub Transaction $stub_tx_input $stub_tx_output"
  stub_transaction=`bitcoin-cli createrawtransaction $stub_tx_input $stub_tx_output`
  echo "Signing Stub Transaction $index"
  stub_signed_transaction=`bitcoin-cli signrawtransactionwithwallet $stub_transaction | jq -r '.hex'`
  echo "Broadcasting Stub Transaction $index"
  bitcoin-cli sendrawtransaction $stub_signed_transaction
done
echo "Mempool info:"
bitcoin-cli getmempoolinfo

echo "Press Enter to broadcast the transaction"
read
bitcoin-cli sendrawtransaction $signed_transaction

echo "The transaction should now be in the mempool, press Enter to mine it"
read
bitcoin-cli generatetoaddress 1 `bitcoin-cli getnewaddress`

echo "Press Enter to mine 5 more blocks so the transaction will be fully confirmed"
read
bitcoin-cli generatetoaddress 1 `bitcoin-cli getnewaddress`
for block_index in {1..4}
do
  echo "sleeping 5 seconds before mining the next block"
  sleep 5
  bitcoin-cli generatetoaddress 1 `bitcoin-cli getnewaddress`
done
