const bitcoinjs = require('bitcoinjs-lib')
const BigNumber = require('bignumber.js')
const _ = require('lodash')
const encodeAssetId = require('./assetIdEncoder')
const WA = require('./transaction')
const findBestMatchByNeededAssets = require('./findBestMatchByNeededAssets')
const debug = require('debug')('transactionBuilder')
const bufferReverse = require('buffer-reverse')

const WA_TX_VERSION = 0x03
const wienchainTestnetNetwork = {
  messagePrefix: '\x18WienChain Signed Message:\n',
  bip32: {
    public: 0x043587cf,
    private: 0x04358394,
  },
  pubKeyHash: 0x87,
  scriptHash: 0x13,
  wif: 0xef,
  dustThreshold: 546,
}

const wienchainMainnetNetwork = {
  messagePrefix: '\x18WienChain Signed Message:\n',
  bip32: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  pubKeyHash: 0x49,
  scriptHash: 0x12,
  wif: 0xa1,
  dustThreshold: 546,
}

const WienAssetBuilder = function (properties) {
  properties = properties || {}

  if (
    typeof properties.network !== 'undefined' &&
    properties.network !== 'testnet' &&
    properties.network !== 'mainnet'
  ) {
    throw new Error('"network" must be either "testnet" or "mainnet"')
  }
  this.network = properties.network || 'mainnet' // 'testnet' or 'mainnet'

  if (properties.defaultFee) {
    this.defaultFee = parseInt(properties.defaultFee) || 10000
  }
  this.defaultFeePerKb = parseInt(properties.defaultFeePerKb) || 25000

  this.mindustvalue = parseInt(properties.mindustvalue) || 5741
  this.mindustvaluemultisig = parseInt(properties.mindustvaluemultisig) || 5741
  this.writemultisig = properties.writemultisig || true
}

WienAssetBuilder.prototype.buildIssueTransaction = function (args) {
  const self = this
  if (!args.utxos) {
    throw new Error('Must have "utxos"')
  }

  if (!args.issueAddress) {
    throw new Error('Must have "issueAddress"')
  }
  if (!args.amount) {
    throw new Error('Must have "amount"')
  }

  if (args.fee) {
    args.fee = parseInt(args.fee)
  }

  args.aggregationPolicy = args.aggregationPolicy || 'aggregatable'
  args.divisibility =
    args.aggregationPolicy === 'aggregatable' && args.divisibility
      ? args.divisibility
      : 0
  if (args.aggregationPolicy === 'aggregatable') args.fee = 500000000000

  const txb = new bitcoinjs.TransactionBuilder(
    self.network === 'testnet'
      ? wienchainTestnetNetwork
      : wienchainMainnetNetwork
  )
  // find inputs to cover the issuance
  const ccArgs = self._addInputsForIssueTransaction(txb, args)
  if (!ccArgs.success) {
    throw new Error('Not enough WIEN to cover asset issuance transaction')
  }
  _.assign(ccArgs, args)
  const res = self._encodeColorScheme(ccArgs)
  res.assetId = ccArgs.assetId
  return res
}

WienAssetBuilder.prototype._addInputsForIssueTransaction = function (
  txb,
  args
) {
  const self = this
  const utxos = args.utxos
  let assetId = ''
  let current
  let cost

  // simple mode
  if (args.financeOutput) {
    current = new BigNumber(args.financeOutput.value)
    cost = new BigNumber(self._getIssuanceCost(args))

    txb.addInput(args.financeOutputTxid, args.financeOutput.n)
    if (args.flags && args.flags.injectPreviousOutput) {
      const chunks = bitcoinjs.script.decompile(
        Buffer.from(args.financeOutput.scriptPubKey.hex, 'hex')
      )
      txb.tx.ins[txb.tx.ins.length - 1].script = bitcoinjs.script.compile(
        chunks
      )
    }

    assetId = self._encodeAssetId(
      args.reissueable,
      args.financeOutputTxid,
      args.financeOutput.n,
      args.financeOutput.scriptPubKey.hex,
      args.divisibility,
      args.aggregationPolicy
    )

    return {
      txb: txb,
      args: args,
      change: current - cost,
      assetId: assetId,
      totalInputs: { amount: current },
    }
  }

  // add to transaction enough inputs so we can cover the cost
  // send change if any back to us
  current = new BigNumber(0)
  cost = new BigNumber(self._getIssuanceCost(args))
  let change = new BigNumber(0)
  const hasEnoughEquity = utxos.some(function (utxo) {
    if (
      !isInputInTx(txb.tx, utxo.txid, utxo.index) &&
      !(utxo.assets && utxo.assets.length)
    ) {
      debug('current amount ' + utxo.value + ' needed ' + cost)
      debug('utxo.txid', utxo.txid)
      debug('utxo.index', utxo.index)
      txb.addInput(utxo.txid, utxo.index)
      if (txb.tx.ins.length === 1) {
        // encode asset
        debug(txb.tx.ins[0].script)
        assetId = self._encodeAssetId(
          args.reissueable,
          utxo.txid,
          utxo.index,
          utxo.scriptPubKey.hex,
          args.divisibility,
          args.aggregationPolicy
        )
      }
      debug('math: ' + current.toNumber() + ' ' + utxo.value)
      current = current.plus(utxo.value)
      if (args.flags && args.flags.injectPreviousOutput) {
        const chunks = bitcoinjs.script.decompile(
          Buffer.from(utxo.scriptPubKey.hex, 'hex')
        )
        txb.tx.ins[txb.tx.ins.length - 1].script = bitcoinjs.script.compile(
          chunks
        )
      }
      debug(
        'current amount: ' +
          current +
          ' projected cost: ' +
          cost +
          ' are were there yet: ' +
          (current.comparedTo(cost) >= 0)
      )
    } else {
      debug(
        'skipping utxo for input, asset found in utxo: ' +
          utxo.txid +
          ':' +
          utxo.index
      )
    }
    return current.comparedTo(cost) >= 0
  })
  debug('hasEnoughEquity: ' + hasEnoughEquity)
  if (!hasEnoughEquity) {
    return { success: false }
  }

  change = current - cost
  debug('finished adding inputs to tx')
  debug('change ' + change)
  return {
    success: true,
    txb: txb,
    change: change,
    assetId: assetId,
    totalInputs: { amount: current },
  }
}

WienAssetBuilder.prototype._getIssuanceCost = function (args) {
  const self = this
  const fee = args.fee || self.defaultFee
  let totalCost = fee
  debug('_getTotalIssuenceCost: fee =', fee)
  if (args.transfer && args.transfer.length) {
    args.transfer.forEach(function (to) {
      totalCost += self.mindustvalue
    })
  }

  // TODO: calculate multisig only if actually needed
  if (args.metadata) {
    totalCost += self.writemultisig ? self.mindustvaluemultisig : 0
  }

  // change
  totalCost += self.mindustvalue

  debug('_getTotalIssuenceCost: totalCost =', totalCost)
  return totalCost
}

WienAssetBuilder.prototype._encodeAssetId = function (
  reissueable,
  txid,
  nvout,
  hex,
  divisibility,
  aggregationPolicy
) {
  const opts = {
    ccdata: [
      {
        type: 'issuance',
        lockStatus: !reissueable,
        divisibility: divisibility,
        aggregationPolicy: aggregationPolicy,
      },
    ],
    vin: [
      {
        txid: txid,
        vout: nvout,
        previousOutput: {
          hex: hex,
        },
      },
    ],
  }

  if (!reissueable) {
    debug('sending assetIdEncoder locked, first input = ' + txid + ':' + nvout)
  } else {
    debug(
      'sending assetIdEncoder unlocked, first input previousOutput = ',
      opts.vin[0].previousOutput
    )
  }

  debug('encoding asset is locked: ' + !reissueable)
  debug(opts)
  const assetId = encodeAssetId(opts)
  debug('assetId: ' + assetId)
  return assetId
}

WienAssetBuilder.prototype._encodeColorScheme = function (args) {
  const self = this
  let addMultisig = false
  const encoder = WA.newTransaction(0x5741, WA_TX_VERSION)
  const reedemScripts = []
  const coloredOutputIndexes = []
  const txb = args.txb
  let coloredAmount = args.amount
  const fee = args.fee || self.defaultFee
  let lockStatus
  if (typeof args.lockStatus !== 'undefined') {
    lockStatus = args.lockStatus
  } else if (typeof args.reissueable !== 'undefined') {
    lockStatus = !args.reissueable
  } else if (typeof args.reissuable !== 'undefined') {
    lockStatus = !args.reissuable
  }
  if (typeof lockStatus === 'undefined') {
    // default
    lockStatus = true
  }
  encoder.setLockStatus(lockStatus)
  encoder.setAggregationPolicy(args.aggregationPolicy)
  if (args.aggregationPolicy === 'aggregatable') {
    encoder.setAmount(args.amount, args.divisibility)
  } else {
    encoder.setAmount(1, 0)
  }
  if (args.ipfsHash) {
    encoder.setHash(args.ipfsHash)
  }

  if (args.transfer) {
    args.transfer.forEach(function (transferobj, i) {
      debug('payment ' + transferobj.amount + ' ' + txb.tx.outs.length)
      encoder.addPayment(0, transferobj.amount, txb.tx.outs.length)
      coloredAmount -= transferobj.amount
      // check multisig
      if (transferobj.pubKeys && transferobj.m) {
        const multisig = self._generateMultisigAddress(
          transferobj.pubKeys,
          transferobj.m
        )
        reedemScripts.push({
          index: txb.tx.outs.length,
          reedemScript: multisig.reedemScript,
          address: multisig.address,
        })
        txb.addOutput(multisig.address, self.mindustvalue)
      } else {
        txb.addOutput(transferobj.address, self.mindustvalue)
      }
    })
  }

  if (coloredAmount < 0) {
    throw new Error(
      'Error constructing transaction. Attempting to transfer more than issued'
    )
  }

  // add OP_RETURN
  debug('before encode done')
  let buffer = encoder.encode()

  debug('encoding done, buffer: ', buffer)
  if (buffer.leftover && buffer.leftover.length > 0) {
    encoder.shiftOutputs()
    buffer = encoder.encode()
    addMultisig = true
    reedemScripts.forEach(function (item) {
      item.index += 1
    })
  }
  const ret = bitcoinjs.script.compile([
    bitcoinjs.opcodes.OP_RETURN,
    buffer.codeBuffer,
  ])

  // Coin Burn
  if (args.aggregationPolicy === 'aggregatable') {
    txb.addOutput(ret, 500000000000)
  } else {
    txb.addOutput(ret, 100000000)
  }

  // add array of colored ouput indexes
  encoder.payments.forEach(function (payment) {
    coloredOutputIndexes.push(payment.output)
  })

  // need to encode hashes in first tx
  if (addMultisig) {
    if (buffer.leftover && buffer.leftover.length === 1) {
      self._addHashesOutput(txb.tx, buffer.leftover[0])
    } else {
      throw new Error('enough room for hashes: we offsetted inputs for nothing')
    }
  }

  // add change
  const allOutputValues = _.sumBy(txb.tx.outs, function (output) {
    return output.value
  })
  debug(
    'all inputs: ' +
      args.totalInputs.amount +
      ' all outputs: ' +
      allOutputValues
  )
  let lastOutputValue = args.totalInputs.amount - (allOutputValues + fee)
  if (lastOutputValue < self.mindustvalue) {
    const totalCost = self.mindustvalue + args.totalInputs.amount.toNumber()
    throw new Error(
      `Not enough WIEN to cover the transaction fee. Required additional ${
        self.mindustvalue - lastOutputValue
      } to cover the fee of ${totalCost}`
    )
  }

  const changeAddress = args.financeChangeAddress || args.issueAddress

  if (lastOutputValue >= 2 * self.mindustvalue && coloredAmount > 0) {
    const bitcoinChange = lastOutputValue - self.mindustvalue
    lastOutputValue = self.mindustvalue
    debug('adding bitcoin change output with: ' + bitcoinChange)
    txb.addOutput(changeAddress, bitcoinChange)
  }

  if (coloredAmount > 0) {
    // there's a colored change output
    coloredOutputIndexes.push(txb.tx.outs.length)
  }

  debug('adding change output with: ' + lastOutputValue)
  debug('total inputs: ' + args.totalInputs.amount)
  debug('total fee: ' + fee)
  debug('total output without fee: ' + allOutputValues)
  txb.addOutput(args.issueAddress, lastOutputValue || args.change)
  debug('txHex ', txb.tx.toHex())

  return {
    txHex: txb.tx.toHex(),
    multisigOutputs: reedemScripts,
    coloredOutputIndexes: _.uniq(coloredOutputIndexes),
  }
}

WienAssetBuilder.prototype._generateMultisigAddress = function (pubKeys, m) {
  const self = this
  const ecpubkeys = []
  pubKeys.forEach(function (key) {
    ecpubkeys.push(bitcoinjs.ECPubKey.fromHex(key))
  })
  const script = bitcoinjs.scripts.multisigOutput(m, ecpubkeys)
  const hash = bitcoinjs.crypto.hash160(script)
  const multisigAdress = new bitcoinjs.Address(
    hash,
    self.network === 'testnet'
      ? wienchainTestnetNetwork.scriptHash
      : wienchainMainnetNetwork.scriptHash
  )
  const sendto = multisigAdress.toBase58Check()
  return { address: sendto, reedemScript: script.toHex() }
}

WienAssetBuilder.prototype._addHashesOutput = function (tx, ipfsHash) {
  const chunks = []
  chunks.push(bitcoinjs.opcodes.OP_1)
  chunks.push(
    Buffer.from(
      '023cce9dee67e1c52da20b5b8dc68482a264c98b864ce5cd5a355f7608131aae9b',
      'hex'
    )
  )
  chunks.push(Buffer.concat([Buffer.from('03', 'hex'), ipfsHash], 40))
  chunks.push(bitcoinjs.opcodes.OP_2)
  chunks.push(bitcoinjs.opcodes.OP_CHECKMULTISIG)

  debug('chunks', chunks)

  const script = bitcoinjs.script.compile(chunks)

  // try compute value to pass mindust
  // TODO: actually comput it with the fee from the api request, this assumes static fee per kb
  tx.outs.unshift({ script: script, value: 5742 })
}

WienAssetBuilder.prototype._getNoneMinDustByScript = function (script) {
  const self = this
  // add 9 to aacount for bitcoind SER_DISK serilaztion before the multiplication
  return ((self.defaultFeePerKb * (script.length + 148 + 9)) / 1000) * 3
}

function isInputInTx(tx, txid, index) {
  return tx.ins.some(function (input) {
    const id = bufferReverse(input.hash)
    return id.toString('hex') === txid && input.index === index
  })
}

WienAssetBuilder.prototype._insertSatoshiToTransaction = function (
  utxos,
  txb,
  missing,
  inputsValue,
  metadata
) {
  debug('missing: ' + missing)
  let paymentDone = false
  const missingbn = new BigNumber(missing)
  let financeValue = new BigNumber(0)
  let currentAmount = new BigNumber(0)
  if (metadata.financeOutput && metadata.financeOutputTxid) {
    if (
      isInputInTx(txb.tx, metadata.financeOutputTxid, metadata.financeOutput.n)
    ) {
      return false
    }
    financeValue = new BigNumber(metadata.financeOutput.value)
    debug('finance sent through api with value ' + financeValue.toNumber())
    if (financeValue.minus(missingbn) >= 0) {
      // TODO: check there is no asset here
      debug('funding tx ' + metadata.financeOutputTxid)
      txb.tx.addInput(metadata.financeOutputTxid, metadata.financeOutput.n)
      inputsValue.amount += financeValue.toNumber()
      if (metadata.flags && metadata.flags.injectPreviousOutput) {
        const chunks = bitcoinjs.script.decompile(
          Buffer.from(metadata.financeOutput.scriptPubKey.hex, 'hex')
        )
        txb.tx.ins[txb.ins.length - 1].script = bitcoinjs.script.compile(chunks)
      }
      paymentDone = true
      return paymentDone
    } else {
      debug(
        'finance output not added to transaction finace value: ' +
          financeValue.toNumber() +
          ' still needed: ' +
          missingbn.toNumber()
      )
    }
  } else {
    debug('no financeOutput was given')
  }

  const hasEnoughEquity = utxos.some(function (utxo) {
    utxo.value = Math.round(utxo.value)
    if (
      !isInputInTx(txb.tx, utxo.txid, utxo.index) &&
      !(utxo.assets && utxo.assets.length)
    ) {
      debug('current amount ' + utxo.value + ' needed ' + missing)
      txb.addInput(utxo.txid, utxo.index)
      inputsValue.amount += utxo.value
      currentAmount = currentAmount.plus(utxo.value)
      if (metadata.flags && metadata.flags.injectPreviousOutput) {
        const chunks = bitcoinjs.script.decompile(
          Buffer.from(utxo.scriptPubKey.hex, 'hex')
        )
        txb.tx.ins[txb.tx.ins.length - 1].script = bitcoinjs.script.compile(
          chunks
        )
      }
    }
    return currentAmount.comparedTo(missingbn) >= 0
  })

  debug('hasEnoughEquity: ' + hasEnoughEquity)

  return hasEnoughEquity
}

WienAssetBuilder.prototype._tryAddingInputsForFee = function (
  txb,
  utxos,
  totalInputs,
  metadata,
  satoshiCost
) {
  const self = this
  debug(
    'tryAddingInputsForFee: current transaction value: ' +
      totalInputs.amount +
      ' projected cost: ' +
      satoshiCost
  )
  if (satoshiCost > totalInputs.amount) {
    if (
      !self._insertSatoshiToTransaction(
        utxos,
        txb,
        satoshiCost - totalInputs.amount,
        totalInputs,
        metadata
      )
    ) {
      debug('not enough satoshi in account for fees')
      return false
    }
  } else {
    debug('No need for additional finance')
  }
  return true
}

WienAssetBuilder.prototype.buildSendTransaction = function (args) {
  const self = this
  if (!args.utxos) {
    throw new Error('Must have "utxos"')
  }
  if (!args.to) {
    throw new Error('Must have "to"')
  }

  if (args.fee) {
    args.fee = parseInt(args.fee)
  }

  const txb = new bitcoinjs.TransactionBuilder(
    self.network === 'testnet'
      ? wienchainTestnetNetwork
      : wienchainMainnetNetwork
  )

  return self._addInputsForSendTransaction(txb, args)
}

WienAssetBuilder.prototype.buildSendNativeTransaction = function (args) {
  const self = this
  if (!args.utxos) {
    throw new Error('Must have "utxos"')
  }

  if (!args.to) {
    throw new Error('Must have "to"')
  }

  if (args.fee) {
    args.fee = parseInt(args.fee)
  }

  const txb = new bitcoinjs.TransactionBuilder(
    self.network === 'testnet'
      ? wienchainTestnetNetwork
      : wienchainMainnetNetwork
  )
  let financeValue = new BigNumber(0)
  args.to.forEach(function (payment) {
    financeValue = financeValue.add(Math.round(payment.amount))
    txb.addOutput(payment.address, payment.amount)
  })
  // if (args.opreturn) {
  //   // OP RETURN
  //   let ret = bitcoin.script.compile([
  //     bitcoin.opcodes.OP_RETURN,
  //     buffer.codeBuffer
  //   ])

  //   txb.addOutput(ret, 0)
  // }
  let currentAmount = new BigNumber(0)
  let missingbn = new BigNumber(0)
  missingbn = missingbn.add(financeValue)
  missingbn = missingbn.add(args.fee || 100000)
  let hasEnoughEquity = false
  for (let i = 0; i < args.utxos.length; i++) {
    const utxo = args.utxos[i]
    utxo.value = Math.round(utxo.value)
    if (!(utxo.assets && utxo.assets.length)) {
      txb.addInput(utxo.txid, utxo.index)
      currentAmount = currentAmount.add(utxo.value)
    }
    if (currentAmount.comparedTo(missingbn) >= 0) {
      hasEnoughEquity = true
      break
    }
  }

  if (!hasEnoughEquity) {
    throw new Error(
      'Not enough satoshi to cover transaction of ' + missingbn.toString()
    )
  }

  // Actual Fee
  args.fee = args.fee || txb.tx.ins.length * 1000 + args.to.length * 1000 + 2000
  const lastOutputValue = currentAmount.minus(financeValue.add(args.fee))
  txb.addOutput(
    args.financeChangeAddress
      ? args.financeChangeAddress
      : Array.isArray(args.from)
      ? args.from[0]
      : args.from,
    parseInt(lastOutputValue.toString())
  )

  return { txHex: txb.tx.toHex() }
}

WienAssetBuilder.prototype._computeCost = function (withfee, args) {
  const self = this
  let fee = withfee ? args.fee || args.minfee : 0

  if (args.to && args.to.length) {
    args.to.forEach(function (to) {
      fee += self.mindustvalue
    })
  }

  if (args.rules || args.metadata) {
    fee += self.writemultisig ? self.mindustvaluemultisig : 0
  }

  fee += self.mindustvalue

  debug('comupteCost: ' + fee)
  return fee
}

WienAssetBuilder.prototype._getInputAmountNeededForTx = function (tx, fee) {
  const self = this
  let total = fee
  tx.outs.forEach(function (output) {
    total += self._getNoneMinDustByScript(output.script, fee)
  })
  return total
}

WienAssetBuilder.prototype._getChangeAmount = function (
  tx,
  fee,
  totalInputValue
) {
  const allOutputValues = _.sumBy(tx.outs, function (output) {
    return output.value
  })
  debug(
    'getChangeAmount: all inputs: ' +
      totalInputValue.amount +
      ' all outputs: ' +
      allOutputValues
  )
  return totalInputValue.amount - (allOutputValues + fee)
}

WienAssetBuilder.prototype._addInputsForSendTransaction = function (txb, args) {
  const self = this
  args.fee = args.fee || 300000
  let satoshiCost = args.fee
    ? self._computeCost(true, args)
    : self._computeCost(false, args)
  const totalInputs = { amount: 0 }
  const reedemScripts = []
  const coloredOutputIndexes = []

  debug('addInputsForSendTransaction')

  if (args.from) {
    debug('got unspents for address: ' + args.from)
  } else {
    debug('got unspents from parmameter: ' + args.utxos)
    if (
      args.utxos[0] &&
      args.utxos[0].scriptPubKey &&
      args.utxos[0].scriptPubKey.addresses &&
      args.utxos[0].scriptPubKey.addresses[0]
    ) {
      args.from = args.utxos[0].scriptPubKey.addresses[0]
    }
  }
  const assetList = {}
  args.to.forEach(function (to) {
    debug(to.assetId)
    if (!assetList[to.assetId]) {
      assetList[to.assetId] = {
        amount: 0,
        addresses: [],
        done: false,
        change: 0,
        encodeAmount: 0,
        inputs: [],
      }
    }
    assetList[to.assetId].amount += to.amount
    if (to.burn) {
      assetList[to.assetId].addresses.push({
        address: 'burn',
        amount: to.amount,
      })
    } else if (!to.address && to.pubKeys && to.m) {
      // generate a multisig address, remember to return the redeem scripts
      const multisig = self._generateMultisigAddress(to.pubKeys, to.m)
      assetList[to.assetId].addresses.push({
        address: multisig.address,
        amount: to.amount,
        reedemScript: multisig.reedemScript,
      })
    } else {
      assetList[to.assetId].addresses.push({
        address: to.address,
        amount: to.amount,
      })
    }
  })

  debug('finished creating per asset list')
  for (const asset in assetList) {
    debug('working on asset: ' + asset)
    debug(args.utxos)
    const assetUtxos = args.utxos.filter(function (element, index, array) {
      if (!element.assets) {
        return false
      }
      return element.assets.some(function (a) {
        debug('checking ' + a.assetId + ' and ' + asset)
        return a.assetId === asset
      })
    })
    if (assetUtxos && assetUtxos.length > 0) {
      debug('have utxo list')
      const key = asset
      assetUtxos.forEach(function (utxo) {
        if (utxo.used) {
          debug('utxo', utxo)
          throw new Error(
            'Output ' + utxo.txid + ':' + utxo.index + ' is already spent!'
          )
        }
      })
      if (
        !findBestMatchByNeededAssets(
          assetUtxos,
          assetList,
          key,
          txb,
          totalInputs,
          args
        )
      ) {
        throw new Error(
          'Not enough units of asset ' + key + ' to cover transfer transaction'
        )
      }
    } else {
      debug('no utxo list')
      throw new Error('No output with the requested asset: ' + asset)
    }
  }
  debug('reached encoder')
  debug(txb.tx)
  args.fee = args.fee || txb.tx.ins.length * 1000 + args.to.length * 1000 + 2000 // 2000 for OP_DATA
  satoshiCost = self._computeCost(true, args)
  const encoder = WA.newTransaction(0x5741, WA_TX_VERSION)
  if (
    !self._tryAddingInputsForFee(
      txb,
      args.utxos,
      totalInputs,
      args,
      satoshiCost
    )
  ) {
    throw new Error(
      `Not enough WIEN to cover the transaction fee. Required additional ${
        satoshiCost - totalInputs.amount
      } to cover the fee of ${satoshiCost}`
    )
  }

  for (const asset in assetList) {
    const currentAsset = assetList[asset]
    debug('encoding asset ' + asset)
    if (!currentAsset.done) {
      debug('current asset state is bad ' + asset)
      throw new Error(`Not enough asset ${asset}`)
    }

    debug(currentAsset.addresses)
    const uniqAssets = _.uniqBy(currentAsset.addresses, function (item) {
      return item.address
    })
    debug('uniqAssets = ', uniqAssets)
    uniqAssets.forEach(function (address) {
      debug(
        'adding output ' +
          (txb.tx.outs ? txb.tx.outs.length : 0) +
          ' for address: ' +
          address.address +
          ' with satoshi value ' +
          self.mindustvalue +
          ' asset value: ' +
          address.amount
      )
      let addressAmountLeft = address.amount
      debug(
        'currentAsset = ',
        currentAsset,
        ', currentAsset.inputs.length = ',
        currentAsset.inputs.length
      )
      currentAsset.inputs.some(function (input) {
        if (!input.amount) {
          return false
        }
        if (addressAmountLeft - input.amount > 0) {
          debug(
            'mapping to input ' + input.index + ' with amount ' + input.amount
          )
          if (address.address === 'burn') {
            encoder.addBurn(input.index, input.amount)
          } else {
            encoder.addPayment(
              input.index,
              input.amount,
              txb.tx.outs ? txb.tx.outs.length : 0
            )
          }
          addressAmountLeft -= input.amount
          debug('left to map from next input ' + addressAmountLeft)
          input.amount = 0
          return false
        } else {
          debug(
            'mapping to input ' +
              input.index +
              ' with amount ' +
              addressAmountLeft
          )
          if (address.address === 'burn') {
            encoder.addBurn(input.index, addressAmountLeft)
          } else {
            encoder.addPayment(
              input.index,
              addressAmountLeft,
              txb.tx.outs ? txb.tx.outs.length : 0
            )
          }
          input.amount -= addressAmountLeft
          addressAmountLeft = 0
          return true
        }
      })
      debug('putting output in transaction')
      if (address.address !== 'burn') {
        txb.addOutput(address.address, self.mindustvalue)
      }
      if (address.reedemScript) {
        reedemScripts.push({
          index: txb.tx.outs.length - 1,
          reedemScript: address.reedemScript,
          address: address.address,
        })
      }

      debug(txb.tx)
      debug('adding output ' + (txb.tx.outs.length - 1))
    })
    debug('done adding colored outputs')
  }
  debug('before using encoder')
  // add metadata if we have any
  if (args.ipfsHash && self.writemultisig) {
    encoder.setHash(args.ipfsHash)
  }
  let buffer = encoder.encode()
  if (buffer.leftover && buffer.leftover.length > 0) {
    encoder.shiftOutputs()
    reedemScripts.forEach(function (item) {
      item.index += 1
    })
    buffer = encoder.encode()
    if (buffer.leftover.length === 1) {
      self._addHashesOutput(txb.tx, buffer.leftover[0])
    } else {
      throw new Error('Error constructing transaction')
    }
  }

  // add array of colored ouput indexes
  encoder.payments.forEach(function (payment) {
    if (typeof payment.output !== 'undefined') {
      coloredOutputIndexes.push(payment.output)
    }
  })

  debug('encoding done')
  const ret = bitcoinjs.script.compile([
    bitcoinjs.opcodes.OP_RETURN,
    buffer.codeBuffer,
  ])

  txb.addOutput(ret, 0)
  let lastOutputValue = self._getChangeAmount(txb.tx, args.fee, totalInputs)
  const coloredChange = _.keys(assetList).some(function (assetId) {
    return assetList[assetId].change > 0
  })

  const changeAddress =
    args.financeChangeAddress ||
    (Array.isArray(args.from) ? args.from[0] : args.from)

  const numOfChanges = coloredChange ? (lastOutputValue !== 5741 ? 2 : 1) : 1

  if (lastOutputValue < numOfChanges * self.mindustvalue) {
    debug('trying to add additionl inputs to cover transaction')
    satoshiCost =
      self._getInputAmountNeededForTx(txb.tx, args.fee) +
      numOfChanges * self.mindustvalue
    if (
      !self._tryAddingInputsForFee(
        txb,
        args.utxos,
        totalInputs,
        args,
        satoshiCost
      )
    ) {
      throw new Error(
        `Not enough WIEN to cover the transaction fee. Required additional ${
          self.mindustvalue - lastOutputValue
        } to cover the fee of ${satoshiCost}`
      )
    }
    lastOutputValue = self._getChangeAmount(txb.tx, args.fee, totalInputs)
  }

  debug('numOfChanges', numOfChanges)
  if (numOfChanges === 2) {
    txb.addOutput(changeAddress, lastOutputValue - self.mindustvalue)
    lastOutputValue = self.mindustvalue
  }
  if (coloredChange) {
    coloredOutputIndexes.push(txb.tx.outs.length)
  }
  txb.addOutput(
    coloredChange
      ? args.coloredChangeAddress
        ? args.coloredChangeAddress
        : Array.isArray(args.from)
        ? args.from[0]
        : args.from
      : changeAddress || (Array.isArray(args.from) ? args.from[0] : args.from),
    lastOutputValue
  )
  debug('success')
  return {
    txHex: txb.tx.toHex(),
    metadata: args.ipfsHash,
    multisigOutputs: reedemScripts,
    coloredOutputIndexes: _.uniqBy(coloredOutputIndexes),
  }
}

WienAssetBuilder.prototype.buildBurnTransaction = function (args) {
  const self = this
  args = args || {}
  const to = args.transfer || []
  const burn = args.burn || []
  burn.forEach(function (burnItem) {
    burnItem.burn = true
  })
  to.push.apply(to, burn)
  delete args.transfer
  args.to = to
  return self.buildSendTransaction(args)
}

module.exports = WienAssetBuilder
