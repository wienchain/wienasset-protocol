/* eslint-env mocha */
const TransactionBuilder = require('../index').TransactionBuilder
const WA = require('../index').Transaction
const transactionBuilder = new TransactionBuilder({ network: 'mainnet' })
const assert = require('assert')
const clone = require('clone')
const bitcoinjs = require('bitcoinjs-lib')
const Transaction = bitcoinjs.Transaction
const script = bitcoinjs.script
const _ = require('lodash')

const issueArgs = {
  utxos: [
    {
      txid: '471ac770c53a85ba6ef15d5cfff7a597bfab2c1ed015cc929e35fcd42c9b90df',
      index: 1,
      value: 1000100000000,
      scriptPubKey: {
        addresses: ['WUDUjWsfAuXc96uXGEwqHSafnB7LiGpc3j'],
        hex: '76a9143ccb1b3b68065b3617679db3727fce5f46dff22088ac',
      },
    },
  ],
  issueAddress: 'WUDUjWsfAuXc96uXGEwqHSafnB7LiGpc3j',
  amount: 1500000000000000,
}

describe('builder.buildIssueTransaction(args)', function () {
  it('throws: Must have "utxos"', function (done) {
    const args = clone(issueArgs)
    delete args.utxos
    assert.throws(function () {
      transactionBuilder.buildIssueTransaction(args)
    }, /Must have "utxos"/)
    done()
  })

  it('throws: Must have "issueAddress"', function (done) {
    const args = clone(issueArgs)
    delete args.issueAddress
    assert.throws(function () {
      transactionBuilder.buildIssueTransaction(args)
    }, /Must have "issueAddress"/)
    done()
  })

  it('throws: Must have "amount"', function (done) {
    const args = clone(issueArgs)
    delete args.amount
    assert.throws(function () {
      transactionBuilder.buildIssueTransaction(args)
    }, /Must have "amount"/)
    done()
  })

  it('returns valid response with default values', function (done) {
    const result = transactionBuilder.buildIssueTransaction(issueArgs)
    assert(result.txHex)
    const tx = Transaction.fromHex(result.txHex)
    assert.strictEqual(tx.ins.length, 1)
    assert.strictEqual(tx.outs.length, 3) // OP_RETURN + 2 changes
    assert(result.assetId)
    assert.deepEqual(result.coloredOutputIndexes, [2])
    const sumValueInputs = issueArgs.utxos[0].value
    const sumValueOutputs = _.sumBy(tx.outs, function (output) {
      return output.value
    })
    assert.strictEqual(sumValueInputs - sumValueOutputs, issueArgs.fee)
    const opReturnScriptBuffer = script.decompile(tx.outs[0].script)[1]
    const waTransaction = WA.fromHex(opReturnScriptBuffer)
    assert.strictEqual(waTransaction.type, 'issuance')
    assert.strictEqual(waTransaction.amount, issueArgs.amount)
    // default values
    assert.strictEqual(waTransaction.lockStatus, true)
    assert.strictEqual(waTransaction.divisibility, 0)
    assert.strictEqual(waTransaction.aggregationPolicy, 'aggregatable')
    done()
  })

  it('flags.injectPreviousOutput === true: return previous output hex in inputs', function (done) {
    const args = clone(issueArgs)
    args.flags = { injectPreviousOutput: true }
    const result = transactionBuilder.buildIssueTransaction(args)
    assert(result.txHex)
    const tx = Transaction.fromHex(result.txHex)
    assert.strictEqual(tx.ins.length, 1)
    assert.strictEqual(
      tx.ins[0].script.toString('hex'),
      args.utxos[0].scriptPubKey.hex
    )
    done()
  })

  it('should split change', function (done) {
    const args = clone(issueArgs)
    args.financeChangeAddress = false
    const result = transactionBuilder.buildIssueTransaction(args)
    assert(result.txHex)
    const tx = Transaction.fromHex(result.txHex)
    assert.strictEqual(tx.ins.length, 1)
    assert.strictEqual(tx.outs.length, 3) // OP_RETURN + 1 change
    assert.deepEqual(result.coloredOutputIndexes, [2])
    done()
  })

  it('should not split change', function (done) {
    const args = clone(issueArgs)
    args.utxos[0].value = 1000000005741
    args.financeChangeAddress = false
    const result = transactionBuilder.buildIssueTransaction(args)
    assert(result.txHex)
    const tx = Transaction.fromHex(result.txHex)
    assert.strictEqual(tx.ins.length, 1)
    assert.strictEqual(tx.outs.length, 2) // OP_RETURN + 1 change
    assert.deepEqual(result.coloredOutputIndexes, [1])
    done()
  })

  it('should encode ipfsHash', function (done) {
    const args = clone(issueArgs)
    args.ipfsHash =
      '122040c49203747ff2131a38810837dbcb9e83fd0ef57c18c685342991f8a191c940'
    const result = transactionBuilder.buildIssueTransaction(args)
    const tx = Transaction.fromHex(result.txHex)
    const opReturnScriptBuffer = script.decompile(tx.outs[0].script)[1]
    const waTransaction = WA.fromHex(opReturnScriptBuffer)
    assert.strictEqual(waTransaction.ipfsHash.toString('hex'), args.ipfsHash)
    done()
  })
})

const sendArgs = {
  utxos: [
    {
      index: 0,
      txid: '72505974f4ef005a902bca4db19025219ef4baa5b5d0ec2268a91b0336e00802',
      blocktime: 1586408108000,
      blockheight: 170304,
      value: 5741,
      isCoinbase: false,
      used: false,
      scriptPubKey: {
        asm:
          'OP_DUP OP_HASH160 e87fb14ac8daef9a1b98c81f109fa5ac138e439b OP_EQUALVERIFY OP_CHECKSIG',
        hex: '76a914e87fb14ac8daef9a1b98c81f109fa5ac138e439b88ac',
        reqSigs: 1,
        type: 'pubkeyhash',
        addresses: ['WjsNcfayUrmPTXCpGanSc1ruQt9ftUPgw2'],
      },
      assets: [
        {
          assetId: 'La4Su8sucHfTj4ggGF1NQeBKwF3hUiJG1NU9GP',
          amount: 75987900000000,
          issueTxid:
            '06c4a5fc6b3de7de5dffd3c90424eb17aa435e8ce31bc983acfd019d08232e6c',
          divisibility: 5,
          lockStatus: true,
          aggregationPolicy: 'aggregatable',
        },
      ],
    },
    {
      index: 1,
      txid: '1ef1d5fe9a9f499358e92d5f3912fac0f224ef3e1b7e6d5450e2d18d001fe3ad',
      blocktime: 1586617313117,
      blockheight: -1,
      value: 100000000,
      isCoinbase: false,
      used: false,
      scriptPubKey: {
        asm:
          'OP_DUP OP_HASH160 e87fb14ac8daef9a1b98c81f109fa5ac138e439b OP_EQUALVERIFY OP_CHECKSIG',
        hex: '76a914e87fb14ac8daef9a1b98c81f109fa5ac138e439b88ac',
        reqSigs: 1,
        type: 'pubkeyhash',
        addresses: ['WjsNcfayUrmPTXCpGanSc1ruQt9ftUPgw2'],
      },
      assets: [],
    },
  ],
  to: [
    {
      address: 'WUDUjWsfAuXc96uXGEwqHSafnB7LiGpc3j',
      amount: 20,
      assetId: 'La4Su8sucHfTj4ggGF1NQeBKwF3hUiJG1NU9GP',
    },
  ],
  fee: 5000,
}

describe('builder.buildSendTransaction(args)', function () {
  it('throws: Must have "utxos"', function (done) {
    const args = clone(sendArgs)
    delete args.utxos
    assert.throws(function () {
      transactionBuilder.buildSendTransaction(args)
    }, /Must have "utxos"/)
    done()
  })

  it('throws: Must have "to"', function (done) {
    const args = clone(sendArgs)
    delete args.to
    assert.throws(function () {
      transactionBuilder.buildSendTransaction(args)
    }, /Must have "to"/)
    done()
  })

  it('returns valid response with default values', function (done) {
    sendArgs.fee = 5000
    const result = transactionBuilder.buildSendTransaction(sendArgs)
    assert(result.txHex)
    const tx = Transaction.fromHex(result.txHex)
    assert.strictEqual(tx.ins.length, 2)
    assert.strictEqual(tx.outs.length, 4) // transfer + OP_RETURN + 2 changes
    assert.deepEqual(result.coloredOutputIndexes, [0, 3])
    const sumValueInputs = sendArgs.utxos[0].value + sendArgs.utxos[1].value
    const sumValueOutputs = _.sumBy(tx.outs, function (output) {
      return output.value
    })
    assert.strictEqual(sumValueInputs - sumValueOutputs, sendArgs.fee)
    const opReturnScriptBuffer = script.decompile(tx.outs[1].script)[1]
    const waTransaction = WA.fromHex(opReturnScriptBuffer)
    assert.strictEqual(waTransaction.type, 'transfer')
    assert.strictEqual(waTransaction.payments[0].range, false)
    assert.strictEqual(waTransaction.payments[0].output, 0)
    assert.strictEqual(waTransaction.payments[0].input, 0)
    assert.strictEqual(waTransaction.payments[0].percent, false)
    assert.strictEqual(waTransaction.payments[0].amount, sendArgs.to[0].amount)
    done()
  })

  it('returns valid response with 31 Outputs and Metadata', function (done) {
    const addresses = [
      'WT6yzaohMYNBLnwzRrLqE7gvvw25oebAa9',
      'WhGLPjqrbjseuJ2qTQ8vX6WKrRen5vjTKZ',
      'WWrm5G7X2mroCSrpziTq5MhCJEEj2KScHx',
      'WjjQmQgVZMHiPEjcRCqd24KZEo6xdpL7pW',
      'WgTcFwqqvVbLP8tF1wPFb1GG4BJxmjhngZ',
      'WjYdZ3feTPMwqSGQ1A5jewnMGsUFmqvqZt',
      'WXTYUatqfwgLvwjxGEvg53yD6ZCyCxBvWK',
      'Wf5dDhXAJjgMMAvaUzKuVFxdisZMUE6iGc',
      'WRpX1tZHszWngBUyvHVnPWAo4ijHsEjNM2',
      'WY6VfGdfbB8gC6sGcR8wqyhb7drWNN8DjW',
      'WXJ2sYVDTUu4jbHE9SaUT4gWrhzXSRLBzw',
      'WbMvKa81pdcDQ41fm6CWhzUoA5NLaQqCdy',
      'WYAD4GCpMmVL5CxXrx9E6DH3ZxaR2q4wVe',
      'WhQYsBZ3ju4oyirNSQCzMw1ArSpHgK8GJj',
      'WYixoqccqf6CWFnm7z4aykdy5FgqXdWFVV',
      'WexVrReRmnNokWRpMZi3gPthvnGuQ1yJQj',
      'WjcNgpgC4DsTnLRE73BTiMLvEWWYGKgxFg',
      'WUgqJbB14LYnJpQPWWXCV84sFMSvuqR9Cx',
      'WjiqCjVneWJdGjvqEVzpVBqXHasrFdgz2M',
      'WkAPtCLCa6t1aChGL4mkbAB9BCRPTKPqd4',
      'WVTtqo3NbJBsMuk47PTXRVvLkWT6E4NTKh',
      'WXyCJo62f3g7rynAPnJGg6K8XrGRuQ2PuX',
      'WXvFQuo6wEBe46Bo3XUBNcFpFqn4PZLpEb',
      'WWUX5AAHuqtFdzGfDwFndwMhF1nJUcrmg9',
      'WiYy84BM5cofHVfCEs6GXYnK6in1vZopMF',
      'WZYPvHV8MQuSZ3eLHdDL5fJVJnLUrcE72G',
      'WUJR4Te9r3L3Jp8V724gQ1iCpDxJ69VDKs',
      'WPQgrSy1bgxfoZ6bfNnLom3aLcqL8GbZAV',
      'WSDjb11jsP9zqPrZmuC3H7dPXRinwRrASm',
      'WdRDWzZh62pmV5dYb17gTcjA8utrTFcwtn',
    ]

    const args = clone(sendArgs)
    args.ipfsHash =
      '122098ed210c6291c25ae9cd40a85aeced620ef2c4c169e0cdc2be2091ddf3a352e3'
    for (const address of addresses) {
      args.to.push({
        address: address,
        amount: 111,
        assetId: 'La4Su8sucHfTj4ggGF1NQeBKwF3hUiJG1NU9GP',
      })
    }
    const result = transactionBuilder.buildSendTransaction(args)
    assert(result.txHex)
    const tx = Transaction.fromHex(result.txHex)
    const opReturnScriptBuffer = script.decompile(tx.outs[31].script)[1]
    const waTransaction = WA.fromHex(opReturnScriptBuffer)
    assert.strictEqual(tx.outs.length, args.to.length + 3)
    assert.strictEqual(waTransaction.ipfsHash.toString('hex'), args.ipfsHash)
    done()
  })

  it('should encode ipfsHash', function (done) {
    const args = clone(sendArgs)
    args.ipfsHash =
      '122098ed210c6291c25ae9cd40a85aeced620ef2c4c169e0cdc2be2091ddf3a352e3'
    const result = transactionBuilder.buildSendTransaction(args)
    const tx = Transaction.fromHex(result.txHex)
    const opReturnScriptBuffer = script.decompile(tx.outs[1].script)[1]
    const waTransaction = WA.fromHex(opReturnScriptBuffer)
    assert.strictEqual(waTransaction.ipfsHash.toString('hex'), args.ipfsHash)
    done()
  })

  it('flags.injectPreviousOutput === true: return previous output hex in inputs', function (done) {
    const args = clone(sendArgs)
    args.flags = { injectPreviousOutput: true }
    const result = transactionBuilder.buildSendTransaction(args)
    assert(result.txHex)
    const tx = Transaction.fromHex(result.txHex)
    assert.strictEqual(tx.ins.length, 2)
    assert.strictEqual(
      tx.ins[0].script.toString('hex'),
      args.utxos[0].scriptPubKey.hex
    )
    done()
  })

  it('should not have finance change', function (done) {
    const args = clone(sendArgs)
    args.utxos[1].value = 10741
    args.fee = 5000
    const result = transactionBuilder.buildSendTransaction(args)
    assert(result.txHex)
    const tx = Transaction.fromHex(result.txHex)
    assert.strictEqual(tx.ins.length, 2)
    assert.strictEqual(tx.outs.length, 3) // transfer + OP_RETURN + 1 change
    assert.deepEqual(result.coloredOutputIndexes, [0, 2])
    done()
  })

  it('should not have colored change', function (done) {
    const args = clone(sendArgs)
    args.to[0].amount = args.utxos[0].assets[0].amount
    args.fee = 5000
    const result = transactionBuilder.buildSendTransaction(args)
    assert(result.txHex)
    const tx = Transaction.fromHex(result.txHex)
    assert.strictEqual(tx.ins.length, 2)
    assert.strictEqual(tx.outs.length, 3) // transfer + OP_RETURN + 1 change
    assert.deepEqual(result.coloredOutputIndexes, [0])
    done()
  })
})

const burnArgs = {
  utxos: [
    {
      index: 0,
      txid: '72505974f4ef005a902bca4db19025219ef4baa5b5d0ec2268a91b0336e00802',
      blocktime: 1586408108000,
      blockheight: 170304,
      value: 5741,
      isCoinbase: false,
      used: false,
      scriptPubKey: {
        asm:
          'OP_DUP OP_HASH160 e87fb14ac8daef9a1b98c81f109fa5ac138e439b OP_EQUALVERIFY OP_CHECKSIG',
        hex: '76a914e87fb14ac8daef9a1b98c81f109fa5ac138e439b88ac',
        reqSigs: 1,
        type: 'pubkeyhash',
        addresses: ['WjsNcfayUrmPTXCpGanSc1ruQt9ftUPgw2'],
      },
      assets: [
        {
          assetId: 'La4Su8sucHfTj4ggGF1NQeBKwF3hUiJG1NU9GP',
          amount: 75987900000000,
          issueTxid:
            '06c4a5fc6b3de7de5dffd3c90424eb17aa435e8ce31bc983acfd019d08232e6c',
          divisibility: 5,
          lockStatus: true,
          aggregationPolicy: 'aggregatable',
        },
      ],
    },
    {
      index: 1,
      txid: '1ef1d5fe9a9f499358e92d5f3912fac0f224ef3e1b7e6d5450e2d18d001fe3ad',
      blocktime: 1586617416000,
      blockheight: 173693,
      value: 100000000,
      isCoinbase: false,
      used: false,
      scriptPubKey: {
        asm:
          'OP_DUP OP_HASH160 e87fb14ac8daef9a1b98c81f109fa5ac138e439b OP_EQUALVERIFY OP_CHECKSIG',
        hex: '76a914e87fb14ac8daef9a1b98c81f109fa5ac138e439b88ac',
        reqSigs: 1,
        type: 'pubkeyhash',
        addresses: ['WjsNcfayUrmPTXCpGanSc1ruQt9ftUPgw2'],
      },
      assets: [],
    },
  ],
  burn: [
    {
      amount: 75987900000000,
      assetId: 'La4Su8sucHfTj4ggGF1NQeBKwF3hUiJG1NU9GP',
    },
  ],
  fee: 5000,
}

describe('builder.buildBurnTransaction(args)', function () {
  it('returns valid response when burn completely', function (done) {
    const result = transactionBuilder.buildBurnTransaction(burnArgs)
    assert(result.txHex)
    const tx = Transaction.fromHex(result.txHex)
    assert.strictEqual(tx.ins.length, 2)
    assert.strictEqual(tx.outs.length, 2) // OP_RETURN + 2 changes
    assert.deepEqual(result.coloredOutputIndexes, [])
    const sumValueInputs = burnArgs.utxos[0].value + burnArgs.utxos[1].value
    const sumValueOutputs = _.sumBy(tx.outs, function (output) {
      return output.value
    })
    assert.strictEqual(sumValueInputs - sumValueOutputs, burnArgs.fee)
    const opReturnScriptBuffer = script.decompile(tx.outs[0].script)[1]
    const waTransaction = WA.fromHex(opReturnScriptBuffer)
    assert.strictEqual(waTransaction.type, 'burn')
    assert.strictEqual(waTransaction.payments[0].burn, true)
    assert.strictEqual(waTransaction.payments[0].input, 0)
    assert.strictEqual(
      waTransaction.payments[0].amount,
      burnArgs.burn[0].amount
    )
    done()
  })

  it('returns valid response when burn partially', function (done) {
    burnArgs.burn[0].amount = 100
    const result = transactionBuilder.buildBurnTransaction(burnArgs)
    assert(result.txHex)
    const tx = Transaction.fromHex(result.txHex)
    assert.strictEqual(tx.ins.length, 2)
    assert.strictEqual(tx.outs.length, 3) // OP_RETURN + 2 changes
    assert.deepEqual(result.coloredOutputIndexes, [2])
    const sumValueInputs = burnArgs.utxos[0].value + burnArgs.utxos[1].value
    const sumValueOutputs = _.sumBy(tx.outs, function (output) {
      return output.value
    })
    assert.strictEqual(sumValueInputs - sumValueOutputs, burnArgs.fee)
    const opReturnScriptBuffer = script.decompile(tx.outs[0].script)[1]
    const waTransaction = WA.fromHex(opReturnScriptBuffer)
    assert.strictEqual(waTransaction.type, 'burn')
    assert.strictEqual(waTransaction.payments[0].burn, true)
    assert.strictEqual(waTransaction.payments[0].input, 0)
    assert.strictEqual(
      waTransaction.payments[0].amount,
      burnArgs.burn[0].amount
    )
    done()
  })
})
